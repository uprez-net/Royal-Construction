import {
  CommsDirection,
  OutboxEventKind,
  OutboxEventStatus,
  SmsStatus,
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
  commsDefinitelyNotSent,
  isCommsError,
  type CommsChannel,
  type SmsPort,
} from "../../ports/comms";
import {
  attributionUserId,
  isOfficePrincipal,
  type DomainPrincipal,
} from "../../principal";
import { maskNumber, providerColumn, recordCommsHistory } from "../shared";
import { evaluateSmsEligibility, MAX_SMS_LENGTH } from "./policy";
import {
  SMS_MESSAGE_SELECT,
  toSmsMessageRecord,
  type SmsMessageRecord,
} from "./records";
import { applyPendingSmsStatuses } from "./status";

// Texting a lead: the one implementation.
//
// Once, precisely — the same contract as a WhatsApp send
// (lib/domain/leads/whatsapp/send.ts), because the failure it guards against
// is the same: a customer receiving the same text twice, or the office being
// told a text went when it did not.
//
//   - The caller supplies an idempotency key per composed message. No key is
//     derived here.
//   - The message row and its outbox intent are written before the carrier
//     hears anything.
//   - A definite refusal marks the message FAILED and re-opens the intent: the
//     same key is a genuine retry of something nobody received.
//   - An ambiguous failure is never retried. The message is flagged and an
//     operator settles it after checking the carrier's console.
//   - A replay of a key that already sent answers `alreadySent: true`.

export type SendLeadSmsInput = {
  readonly leadId: number;
  readonly idempotencyKey: string;
  readonly body: string;
  readonly now?: Date;
};

export type SendLeadSmsResult = {
  readonly message: SmsMessageRecord;
  readonly alreadySent: boolean;
};

const MAX_KEY_LENGTH = 200;

/** Longer than any adapter's own timeout plus the transactions around it. */
const STALE_SEND_LOCK_MS = 60_000;

const AMBIGUOUS_SEND_MESSAGE =
  "The phone provider didn't confirm whether the text was sent, so it has not been retried. Check the provider's message log, then mark it sent or not sent before sending again.";

export function smsOutboxKey(leadId: number, idempotencyKey: string) {
  return `lead-sms:${leadId}:${idempotencyKey}`;
}

export async function sendLeadSms(
  principal: DomainPrincipal,
  input: SendLeadSmsInput,
  db: TransactionalDomainDb,
  ports: {
    readonly sms?: SmsPort | null;
    readonly channel?: CommsChannel | null;
  } = {},
): Promise<SendLeadSmsResult> {
  const now = input.now ?? new Date();
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Sending an SMS requires a signed-in member of staff.",
    );
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH) {
    throw new DomainValidationError(
      "A send needs an idempotency key so a retry cannot text the customer twice.",
      "idempotencyKey",
    );
  }
  const outboxKey = smsOutboxKey(input.leadId, idempotencyKey);

  const lead = await db.lead.findUnique({
    select: {
      assignedId: true,
      id: true,
      isArchived: true,
      phone: true,
      smsOptedOutAt: true,
    },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  // A replay is answered before the policy is re-run: the text went when it
  // was allowed, and "already sent" is the truthful answer.
  const prior = await db.smsMessage.findUnique({
    select: SMS_MESSAGE_SELECT,
    where: { idempotencyKey: outboxKey },
  });
  if (prior) {
    if (prior.needsReconciliation) {
      throw new DomainTransitionError(
        "This text may already have reached the customer — the provider never confirmed it. Check the provider's message log and mark it sent or not sent before sending again.",
      );
    }
    if (
      prior.status !== SmsStatus.QUEUED
      && prior.status !== SmsStatus.FAILED
    ) {
      return { alreadySent: true, message: toSmsMessageRecord(prior) };
    }
  }

  const port = ports.sms ?? null;
  const channel = ports.channel ?? null;
  if (!port || !channel) {
    throw new DomainSideEffectError(
      "SMS isn't reachable from here, so nothing was sent.",
      "sms",
      false,
    );
  }

  const eligibility = evaluateSmsEligibility({ channel, lead });
  if (!eligibility.allowed) {
    throw new DomainTransitionError(
      eligibility.reason ?? "This lead can't be texted.",
    );
  }
  const sender = eligibility.sender;
  const to = eligibility.phone.e164;
  if (!sender || !to)
    throw new DomainTransitionError("This lead can't be texted.");
  if (sender.provider !== port.provider) {
    // The configured sender and the adapter disagree: a misconfiguration,
    // and sending from a number the carrier does not own would be refused
    // anyway. Say so instead of letting the carrier answer with a code.
    throw new DomainSideEffectError(
      `The SMS number ${sender.e164} belongs to ${sender.provider}, but ${port.provider} is the active provider.`,
      "sms",
      false,
    );
  }

  const body = input.body.trim();
  if (!body) throw new DomainValidationError("Write a message first.", "body");
  if (body.length > MAX_SMS_LENGTH) {
    throw new DomainValidationError(
      `An SMS can be at most ${MAX_SMS_LENGTH} characters.`,
      "body",
    );
  }

  // ── Durable intent, before the carrier hears anything ────────────────────
  const prepared = await db.$transaction(async (tx) => {
    const intent = await enqueueOutboxEvent(tx, {
      key: outboxKey,
      kind: OutboxEventKind.LEAD_SMS_SEND,
      payload: {
        from: sender.e164,
        leadId: lead.id,
        provider: port.provider,
        to,
      },
    });
    if (intent.status === OutboxEventStatus.SUCCEEDED) {
      return { replay: true as const, stale: false as const };
    }
    if (intent.status === OutboxEventStatus.RUNNING) {
      const running = await tx.outboxEvent.findUnique({
        select: { lockedAt: true },
        where: { id: intent.id },
      });
      const lockedFor = running?.lockedAt
        ? now.getTime() - running.lockedAt.getTime()
        : 0;
      if (lockedFor <= STALE_SEND_LOCK_MS) {
        throw new DomainTransitionError(
          "This text is already being sent. Wait for it to finish before trying again.",
        );
      }
      await failOutboxEvent(tx, intent.id, {
        message:
          "The send attempt stopped before the provider's answer was recorded; it may have been delivered.",
        retryable: false,
      });
      await tx.smsMessage.updateMany({
        data: {
          needsReconciliation: true,
          providerErrorTitle:
            "The provider did not confirm this send. Check its message log before sending again.",
        },
        where: { idempotencyKey: outboxKey },
      });
      return { replay: false as const, stale: true as const };
    }
    if (intent.status === OutboxEventStatus.FAILED) {
      throw new DomainTransitionError(
        `This text was already attempted and needs reconciliation before retrying (outbox key ${outboxKey}).`,
      );
    }
    const fields = {
      body,
      businessNumber: sender.e164,
      customerNumber: to,
      failedAt: null,
      occurredAt: now,
      provider: providerColumn(port.provider),
      providerErrorCode: null,
      providerErrorTitle: null,
      status: SmsStatus.QUEUED,
      statusAt: now,
    };
    const message = await tx.smsMessage.upsert({
      create: {
        ...fields,
        authorId: attributionUserId(principal),
        direction: CommsDirection.OUTBOUND,
        idempotencyKey: outboxKey,
        leadId: lead.id,
      },
      select: { id: true },
      // Only reachable for a QUEUED or definitely-FAILED row: nothing
      // reached the customer, so the retry carries what is being sent now.
      update: fields,
      where: { idempotencyKey: outboxKey },
    });
    return {
      messageId: message.id,
      replay: false as const,
      stale: false as const,
    };
  });

  if (prepared.stale) {
    throw new DomainSideEffectError(AMBIGUOUS_SEND_MESSAGE, "sms", false);
  }
  if (prepared.replay) {
    const stored = await db.smsMessage.findUnique({
      select: SMS_MESSAGE_SELECT,
      where: { idempotencyKey: outboxKey },
    });
    if (!stored) {
      throw new DomainTransitionError(
        `This send is recorded as complete but its message is missing (outbox key ${outboxKey}). Reconcile it before retrying.`,
      );
    }
    return { alreadySent: true, message: toSmsMessageRecord(stored) };
  }

  const claimed = await claimOutboxEvent(db, outboxKey);
  if (!claimed) {
    throw new DomainTransitionError(
      "This text is already being sent. Wait for it to finish before trying again.",
    );
  }

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await port.sendSms({
      body,
      from: sender.e164,
      to,
    }));
  } catch (error) {
    const definite = commsDefinitelyNotSent(error);
    const failedAt = new Date();
    await db.$transaction(async (tx) => {
      await failOutboxEvent(tx, claimed.id, {
        message: definite
          ? "The provider refused the text or could not be reached; nothing was delivered."
          : "The provider did not confirm the send; it may have been delivered.",
        retryable: definite,
      });
      await tx.smsMessage.update({
        data: definite
          ? {
              failedAt,
              providerErrorCode: isCommsError(error)
                ? error.providerCode
                : null,
              providerErrorTitle: isCommsError(error) ? error.message : null,
              status: SmsStatus.FAILED,
              statusAt: failedAt,
            }
          : {
              needsReconciliation: true,
              providerErrorTitle:
                "The provider did not confirm this send. Check its message log before sending again.",
            },
        where: { id: prepared.messageId },
      });
    });
    if (definite) {
      throw new DomainSideEffectError(
        `Nothing was sent: ${isCommsError(error) ? error.message : "the provider refused the text."}`,
        "sms",
        true,
        { cause: error },
      );
    }
    throw new DomainSideEffectError(AMBIGUOUS_SEND_MESSAGE, "sms", false, {
      cause: error,
    });
  }

  const sentAt = new Date();
  await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, {
      messageId: prepared.messageId,
      providerMessageId,
    });
    await tx.smsMessage.update({
      data: {
        occurredAt: sentAt,
        providerMessageId,
        // Accepted by the carrier. Delivery arrives as a callback.
        status: SmsStatus.QUEUED,
        statusAt: sentAt,
      },
      where: { id: prepared.messageId },
    });
    await recordCommsHistory(tx, {
      action: "SMS sent",
      at: sentAt,
      detail: `Text sent to ${maskNumber(to)} from ${sender.label} (${sender.e164}).`,
      leadId: lead.id,
      principal,
      type: "SMS",
    });
    await applyPendingSmsStatuses(port.provider, providerMessageId, tx);
  });

  const current = await db.smsMessage.findUnique({
    select: SMS_MESSAGE_SELECT,
    where: { id: prepared.messageId },
  });
  if (!current) throw new DomainNotFoundError("Message not found");
  return { alreadySent: false, message: toSmsMessageRecord(current) };
}

export type ReconcileLeadSmsInput = {
  readonly leadId: number;
  readonly messageId: string;
  readonly outcome: "sent" | "not_sent";
};

/** Settle a send the carrier never confirmed. The only way out of `needsReconciliation`. */
export async function reconcileLeadSms(
  principal: DomainPrincipal,
  input: ReconcileLeadSmsInput,
  db: TransactionalDomainDb,
): Promise<SmsMessageRecord> {
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Reconciling an SMS requires a signed-in member of staff.",
    );
  }
  const message = await db.smsMessage.findUnique({
    select: {
      direction: true,
      id: true,
      lead: { select: { assignedId: true, id: true } },
      needsReconciliation: true,
    },
    where: { id: input.messageId },
  });
  if (!message?.lead || message.lead.id !== input.leadId) {
    throw new DomainNotFoundError("Message not found");
  }
  if (!canAccessLead(principal, message.lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }
  if (
    message.direction !== CommsDirection.OUTBOUND
    || !message.needsReconciliation
  ) {
    throw new DomainTransitionError("This text doesn't need reconciling.");
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.smsMessage.update({
      data:
        input.outcome === "sent"
          ? {
              needsReconciliation: false,
              providerErrorTitle:
                "Confirmed sent by staff after checking the provider.",
              status: SmsStatus.SENT,
              statusAt: now,
            }
          : {
              failedAt: now,
              needsReconciliation: false,
              providerErrorTitle:
                "Confirmed not sent by staff after checking the provider.",
              status: SmsStatus.FAILED,
              statusAt: now,
            },
      select: SMS_MESSAGE_SELECT,
      where: { id: message.id },
    });
    await recordCommsHistory(tx, {
      action: "SMS send reconciled",
      at: now,
      detail:
        input.outcome === "sent"
          ? "An unconfirmed text was confirmed as sent."
          : "An unconfirmed text was confirmed as not sent.",
      leadId: input.leadId,
      principal,
      type: "SMS",
    });
    return toSmsMessageRecord(updated);
  });
}
