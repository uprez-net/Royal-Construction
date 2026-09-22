import {
  OutboxEventKind,
  OutboxEventStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
} from "@prisma/client";

import { canAccessLead } from "../../access/leads";
import type { TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import {
  claimOutboxEvent,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failOutboxEvent,
} from "../../outbox";
import {
  isWhatsAppSendError,
  type WhatsAppPort,
  type WhatsAppSendReceipt,
} from "../../ports/whatsapp";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../../principal";
import {
  evaluateWhatsAppEligibility,
  MAX_WHATSAPP_TEXT_LENGTH,
  WHATSAPP_REFUSALS,
} from "./policy";
import {
  recordWhatsAppHistory,
  toWhatsAppMessageRecord,
  WHATSAPP_MESSAGE_SELECT,
  type LeadWhatsAppMessageRecord,
} from "./records";
import { applyPendingWhatsAppStatuses } from "./status";
import {
  availableWhatsAppTemplates,
  findWhatsAppTemplate,
  renderWhatsAppTemplate,
  validateWhatsAppTemplateParameters,
} from "./templates";

// Sending a WhatsApp message to a lead: the one implementation (issue #333).
//
// The App's composer and Eve's `send_lead_whatsapp_message` both call this.
// Everything that decides whether a customer's phone buzzes is here: who may
// send, to which number (the lead's own primary phone, never one supplied by
// the caller), from which Royal number, whether the platform and the lead's
// consent allow it, and how many times.
//
// Once, precisely:
//
//   - The caller supplies an idempotency key for the *intent* — the App mints
//     one per composed message and keeps it until the send succeeds, Eve uses
//     the tool call id. No key is derived here: a derived key is how a second
//     deliberate follow-up was once reported as sent while nothing went out.
//   - The message row and its outbox intent are written before the provider
//     is called, so a crash after Meta accepted the message still leaves a
//     row saying something may have gone.
//   - A definite refusal (Meta answered no, or was never reached) marks the
//     message FAILED and re-opens the intent: pressing Send again with the same
//     key is a genuine retry of something the customer never received.
//   - An ambiguous failure (timeout, dropped connection, 5xx) is not retried.
//     The message is flagged for reconciliation, the intent is closed, and the
//     operator is told to check before sending again — a duplicate on a
//     client's phone is the expensive outcome.
//   - A replay of a key that already succeeded returns the stored message with
//     `alreadySent: true`. Nothing is sent, and the caller must say so.

export type SendLeadWhatsAppInput = {
  readonly leadId: number;
  /** One per intended message. Required; there is no derived fallback. */
  readonly idempotencyKey: string;
  /** Override the sender. Must be a configured number. */
  readonly businessPhoneNumberId?: string | null;
  readonly message:
    | { readonly kind: "text"; readonly body: string }
    | {
        readonly kind: "template";
        readonly templateName: string;
        readonly parameters: readonly string[];
      };
  readonly now?: Date;
};

export type SendLeadWhatsAppResult = {
  readonly message: LeadWhatsAppMessageRecord;
  /** True when this key had already sent; nothing went out this time. */
  readonly alreadySent: boolean;
};

const MAX_KEY_LENGTH = 200;

export function whatsappOutboxKey(leadId: number, idempotencyKey: string) {
  return `lead-whatsapp:${leadId}:${idempotencyKey}`;
}

export async function sendLeadWhatsAppMessage(
  principal: DomainPrincipal,
  input: SendLeadWhatsAppInput,
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null } = {},
): Promise<SendLeadWhatsAppResult> {
  const now = input.now ?? new Date();

  // Internal staff only — the same rule as email. A CUSTOMER may open the lead
  // assigned to them; that is not a reason to message from Royal's number.
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Sending a WhatsApp message requires a signed-in member of staff.",
    );
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH) {
    throw new DomainValidationError(
      "A send needs an idempotency key so a retry cannot message the customer twice.",
      "idempotencyKey",
    );
  }
  const outboxKey = whatsappOutboxKey(input.leadId, idempotencyKey);

  const lead = await db.lead.findUnique({
    select: {
      assignedId: true,
      id: true,
      isArchived: true,
      name: true,
      phone: true,
      whatsappConsentAt: true,
      whatsappConsentSource: true,
      whatsappOptedOutAt: true,
    },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  // A replay is answered before the policy is re-run: the message went out
  // when it was allowed, and "already sent" is the truthful answer even if the
  // window has since closed.
  const prior = await db.leadWhatsAppMessage.findUnique({
    select: WHATSAPP_MESSAGE_SELECT,
    where: { idempotencyKey: outboxKey },
  });
  if (prior) {
    if (prior.needsReconciliation) {
      throw new DomainTransitionError(
        "This message may already have reached the customer — WhatsApp never confirmed it. Check the conversation in WhatsApp Manager and mark it sent or not sent before sending again.",
      );
    }
    if (
      prior.status !== WhatsAppMessageStatus.QUEUED
      && prior.status !== WhatsAppMessageStatus.FAILED
    ) {
      return { alreadySent: true, message: toWhatsAppMessageRecord(prior) };
    }
  }

  const port = ports.whatsapp ?? null;
  if (!port) {
    // Refused before anything is written: there is no intent to record for a
    // send this runtime cannot make.
    throw new DomainSideEffectError(
      "WhatsApp isn't reachable from here, so nothing was sent. Send it from the lead in the app, or reconcile the outbox once the provider is configured.",
      "whatsapp",
      false,
    );
  }

  const conversations = await db.leadWhatsAppConversation.findMany({
    select: {
      businessPhoneNumberId: true,
      customerPhoneE164: true,
      lastInboundAt: true,
      windowExpiresAt: true,
    },
    where: { leadId: lead.id },
  });
  const eligibility = evaluateWhatsAppEligibility({
    channel: port.channel,
    conversations,
    lead,
    now,
    requestedPhoneNumberId: input.businessPhoneNumberId,
  });
  const sender = eligibility.sender;
  const to = eligibility.phone.e164;

  let composed: {
    kind: WhatsAppMessageKind;
    body: string;
    templateName: string | null;
    templateLanguage: string | null;
    parameters: string[] | null;
  };
  if (input.message.kind === "text") {
    if (!eligibility.text.allowed) {
      throw new DomainTransitionError(
        eligibility.text.reason ?? WHATSAPP_REFUSALS.windowClosed,
      );
    }
    const body = input.message.body.trim();
    if (!body) {
      throw new DomainValidationError("Write a message first.", "body");
    }
    if (body.length > MAX_WHATSAPP_TEXT_LENGTH) {
      throw new DomainValidationError(
        `A WhatsApp message can be at most ${MAX_WHATSAPP_TEXT_LENGTH} characters.`,
        "body",
      );
    }
    composed = {
      body,
      kind: WhatsAppMessageKind.TEXT,
      parameters: null,
      templateLanguage: null,
      templateName: null,
    };
  } else {
    if (!eligibility.template.allowed) {
      throw new DomainTransitionError(
        eligibility.template.reason ?? WHATSAPP_REFUSALS.noConsent,
      );
    }
    const template = findWhatsAppTemplate(input.message.templateName);
    const approved = availableWhatsAppTemplates(port.channel).some(
      (candidate) => candidate.name === template?.name,
    );
    if (!template || !approved) {
      throw new DomainValidationError(
        "That template isn't approved for this WhatsApp account.",
        "templateName",
      );
    }
    const parameters = validateWhatsAppTemplateParameters(
      template,
      input.message.parameters,
    );
    composed = {
      body: renderWhatsAppTemplate(template, parameters),
      kind: WhatsAppMessageKind.TEMPLATE,
      parameters,
      templateLanguage: template.language,
      templateName: template.name,
    };
  }
  // evaluateWhatsAppEligibility refused both kinds above if either is missing.
  if (!sender || !to) {
    throw new DomainTransitionError(WHATSAPP_REFUSALS.noSender);
  }

  // ── Durable intent, before the provider hears anything ───────────────────
  const prepared = await db.$transaction(async (tx) => {
    const intent = await enqueueOutboxEvent(tx, {
      key: outboxKey,
      kind: OutboxEventKind.LEAD_WHATSAPP_SEND,
      payload: {
        from: sender.phoneNumberId,
        leadId: lead.id,
        to,
      },
    });
    if (intent.status === OutboxEventStatus.SUCCEEDED) {
      return { replay: true as const };
    }
    if (intent.status === OutboxEventStatus.RUNNING) {
      throw new DomainTransitionError(
        "This message is already being sent. Wait for it to finish before trying again.",
      );
    }
    if (intent.status === OutboxEventStatus.FAILED) {
      throw new DomainTransitionError(
        `This message was already attempted and needs reconciliation before retrying (outbox key ${outboxKey}).`,
      );
    }

    const conversation = await tx.leadWhatsAppConversation.upsert({
      create: {
        businessDisplayNumber: sender.displayNumber,
        businessPhoneNumberId: sender.phoneNumberId,
        customerPhoneE164: to,
        leadId: lead.id,
      },
      select: { id: true },
      update: {},
      where: {
        leadId_businessPhoneNumberId_customerPhoneE164: {
          businessPhoneNumberId: sender.phoneNumberId,
          customerPhoneE164: to,
          leadId: lead.id,
        },
      },
    });

    const fields = {
      body: composed.body,
      conversationId: conversation.id,
      failedAt: null,
      kind: composed.kind,
      occurredAt: now,
      providerErrorCode: null,
      providerErrorTitle: null,
      status: WhatsAppMessageStatus.QUEUED,
      statusAt: now,
      templateLanguage: composed.templateLanguage,
      templateName: composed.templateName,
      templateParameters: composed.parameters ?? undefined,
    };
    const message = await tx.leadWhatsAppMessage.upsert({
      create: {
        ...fields,
        authorId: attributionUserId(principal),
        direction: WhatsAppMessageDirection.OUTBOUND,
        idempotencyKey: outboxKey,
        leadId: lead.id,
      },
      select: { id: true },
      // Only reachable for a QUEUED or definitely-FAILED row under this key:
      // nothing reached the customer, so the retry carries what the operator
      // is sending now.
      update: fields,
      where: { idempotencyKey: outboxKey },
    });
    return { conversationId: conversation.id, messageId: message.id, replay: false as const };
  });

  if (prepared.replay) {
    const stored = await db.leadWhatsAppMessage.findUnique({
      select: WHATSAPP_MESSAGE_SELECT,
      where: { idempotencyKey: outboxKey },
    });
    if (!stored) {
      throw new DomainTransitionError(
        `This send is recorded as complete but its message is missing (outbox key ${outboxKey}). Reconcile it before retrying.`,
      );
    }
    return { alreadySent: true, message: toWhatsAppMessageRecord(stored) };
  }

  const claimed = await claimOutboxEvent(db, outboxKey);
  if (!claimed) {
    throw new DomainTransitionError(
      "This message is already being sent. Wait for it to finish before trying again.",
    );
  }

  let receipt: WhatsAppSendReceipt;
  try {
    receipt =
      composed.kind === WhatsAppMessageKind.TEXT
        ? await port.sendText({
            body: composed.body,
            fromPhoneNumberId: sender.phoneNumberId,
            to,
          })
        : await port.sendTemplate({
            bodyParameters: composed.parameters ?? [],
            fromPhoneNumberId: sender.phoneNumberId,
            language: composed.templateLanguage ?? "en",
            templateName: composed.templateName ?? "",
            to,
          });
  } catch (error) {
    const sendError = isWhatsAppSendError(error) ? error : null;
    const definite = sendError?.outcome === "not_sent";
    const failedAt = new Date();
    await db.$transaction(async (tx) => {
      await failOutboxEvent(tx, claimed.id, {
        message: definite
          ? "WhatsApp refused the message or could not be reached; nothing was delivered."
          : "WhatsApp did not confirm the send; it may have been delivered.",
        // A definite refusal re-opens the intent so the same key is a genuine
        // retry. An ambiguous one closes it until a person reconciles.
        retryable: definite,
      });
      await tx.leadWhatsAppMessage.update({
        data: definite
          ? {
              failedAt,
              providerErrorCode: sendError?.details.code ?? null,
              providerErrorTitle: sendError?.message ?? null,
              status: WhatsAppMessageStatus.FAILED,
              statusAt: failedAt,
            }
          : {
              needsReconciliation: true,
              providerErrorTitle:
                "WhatsApp did not confirm this send. Check WhatsApp Manager before sending again.",
            },
        where: { id: prepared.messageId },
      });
    });
    if (definite) {
      throw new DomainSideEffectError(
        `Nothing was sent: ${sendError?.message ?? "WhatsApp refused the message."}`,
        "whatsapp",
        true,
        { cause: error },
      );
    }
    throw new DomainSideEffectError(
      "WhatsApp didn't confirm whether the message was sent, so it has not been retried. Check the conversation in WhatsApp Manager, then mark the message sent or not sent before sending again.",
      "whatsapp",
      false,
      { cause: error },
    );
  }

  const sentAt = new Date();
  const message = await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, {
      messageId: prepared.messageId,
      providerMessageId: receipt.providerMessageId,
    });
    const updated = await tx.leadWhatsAppMessage.update({
      data: {
        occurredAt: sentAt,
        providerMessageId: receipt.providerMessageId,
        status: WhatsAppMessageStatus.SENT,
        statusAt: sentAt,
      },
      select: WHATSAPP_MESSAGE_SELECT,
      where: { id: prepared.messageId },
    });
    await tx.leadWhatsAppConversation.update({
      data: { lastMessageAt: sentAt, lastOutboundAt: sentAt },
      where: { id: prepared.conversationId },
    });
    await recordWhatsAppHistory(tx, {
      action: "WhatsApp sent",
      at: sentAt,
      detail:
        composed.kind === WhatsAppMessageKind.TEMPLATE
          ? `Template “${composed.templateName}” sent to ${to} from ${sender.label} (${sender.displayNumber}).`
          : `Message sent to ${to} from ${sender.label} (${sender.displayNumber}).`,
      leadId: lead.id,
      principal,
    });
    await applyPendingWhatsAppStatuses(receipt.providerMessageId, tx);
    return updated;
  });

  // Re-read so any callback applied above is reflected in what is returned.
  const current = await db.leadWhatsAppMessage.findUnique({
    select: WHATSAPP_MESSAGE_SELECT,
    where: { id: message.id },
  });
  return {
    alreadySent: false,
    message: toWhatsAppMessageRecord(current ?? message),
  };
}

export type ReconcileLeadWhatsAppInput = {
  readonly leadId: number;
  readonly messageId: string;
  /** What the operator found in WhatsApp Manager. */
  readonly outcome: "sent" | "not_sent";
};

/**
 * Settle a send WhatsApp never confirmed.
 *
 * The only way out of `needsReconciliation`. A person looked at the business
 * account and says what happened; the record follows. The outbox intent stays
 * closed either way — the next send is a new intent with a new key.
 */
export async function reconcileLeadWhatsAppMessage(
  principal: DomainPrincipal,
  input: ReconcileLeadWhatsAppInput,
  db: TransactionalDomainDb,
): Promise<LeadWhatsAppMessageRecord> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Reconciling a WhatsApp message requires a signed-in member of staff.",
    );
  }
  const message = await db.leadWhatsAppMessage.findUnique({
    select: {
      conversationId: true,
      direction: true,
      id: true,
      lead: { select: { assignedId: true, id: true } },
      needsReconciliation: true,
    },
    where: { id: input.messageId },
  });
  if (!message || message.lead.id !== input.leadId) {
    throw new DomainNotFoundError("Message not found");
  }
  if (!canAccessLead(principal, message.lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }
  if (
    message.direction !== WhatsAppMessageDirection.OUTBOUND
    || !message.needsReconciliation
  ) {
    throw new DomainTransitionError(
      "This message doesn't need reconciling.",
    );
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.leadWhatsAppMessage.update({
      data:
        input.outcome === "sent"
          ? {
              needsReconciliation: false,
              providerErrorTitle: "Confirmed sent by staff after checking WhatsApp.",
              status: WhatsAppMessageStatus.SENT,
              statusAt: now,
            }
          : {
              failedAt: now,
              needsReconciliation: false,
              providerErrorTitle:
                "Confirmed not sent by staff after checking WhatsApp.",
              status: WhatsAppMessageStatus.FAILED,
              statusAt: now,
            },
      select: WHATSAPP_MESSAGE_SELECT,
      where: { id: message.id },
    });
    if (input.outcome === "sent") {
      await tx.leadWhatsAppConversation.update({
        data: { lastMessageAt: now, lastOutboundAt: now },
        where: { id: message.conversationId },
      });
    }
    await recordWhatsAppHistory(tx, {
      action: "WhatsApp send reconciled",
      at: now,
      detail:
        input.outcome === "sent"
          ? "An unconfirmed WhatsApp message was confirmed as sent."
          : "An unconfirmed WhatsApp message was confirmed as not sent.",
      leadId: input.leadId,
      principal,
    });
    return toWhatsAppMessageRecord(updated);
  });
}
