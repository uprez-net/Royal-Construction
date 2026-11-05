import {
  OutboxEventKind,
  OutboxEventStatus,
  WhatsAppCallPermissionStatus,
} from "@prisma/client";

import { canAccessLead } from "../access/leads";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import {
  claimOutboxEvent,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failOutboxEvent,
} from "../outbox";
import {
  isWhatsAppSendError,
  type WhatsAppBusinessNumber,
  type WhatsAppChannel,
  type WhatsAppPort,
} from "../ports/whatsapp";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { recordWhatsAppHistory } from "../leads/whatsapp/records";
import { evaluateWhatsAppEligibility } from "../leads/whatsapp/policy";
import { waIdToE164 } from "../leads/whatsapp/phone";

// Permission to call a customer on WhatsApp (file 01 §14).
//
// Meta's rules, as modelled on the research date (VERIFY before launch):
//   - Royal asks with an interactive message, which is only delivered inside
//     the 24-hour customer-service window.
//   - At most one request a day and two a week per customer.
//   - A grant lasts seven days unless the customer makes it permanent.
//   - Only the customer's tap on "Allow" is a grant — never a typed "yes".
// Meta enforces these too. Modelling them here means the office reads why
// before pressing the button, not an error code after.

export const PERMISSION_REQUEST_TEXT =
  "Royal Constructions would like to be able to call you on WhatsApp about your build. Tap below to allow calls.";

const DAY_MS = 24 * 60 * 60 * 1000;

export type WhatsAppCallPermissionState = {
  readonly status: "NONE" | WhatsAppCallPermissionStatus | "EXPIRED";
  readonly permanent: boolean;
  readonly expiresAt: Date | null;
  readonly canCall: boolean;
  readonly canRequest: boolean;
  /** Why calling or asking is not possible now. */
  readonly reason: string | null;
  readonly sender: WhatsAppBusinessNumber | null;
  readonly customerPhoneE164: string | null;
};

type PermissionRow = {
  readonly status: WhatsAppCallPermissionStatus;
  readonly permanent: boolean;
  readonly expiresAt: Date | null;
  readonly requestedAt: readonly Date[];
};

export function evaluateWhatsAppCallPermission(input: {
  readonly lead: Parameters<typeof evaluateWhatsAppEligibility>[0]["lead"];
  readonly channel: WhatsAppChannel | null;
  readonly conversations: Parameters<typeof evaluateWhatsAppEligibility>[0]["conversations"];
  readonly permission: PermissionRow | null;
  readonly now: Date;
}): WhatsAppCallPermissionState {
  const eligibility = evaluateWhatsAppEligibility({
    channel: input.channel,
    conversations: input.conversations,
    lead: input.lead,
    now: input.now,
  });
  const permission = input.permission;
  const expired =
    permission?.status === WhatsAppCallPermissionStatus.GRANTED
    && !permission.permanent
    && permission.expiresAt !== null
    && permission.expiresAt.getTime() <= input.now.getTime();
  const status = !permission ? "NONE" : expired ? "EXPIRED" : permission.status;
  const recent = (permission?.requestedAt ?? []).map((at) => input.now.getTime() - at.getTime());
  const rateLimited =
    recent.filter((age) => age < DAY_MS).length >= 1
    || recent.filter((age) => age < 7 * DAY_MS).length >= 2;
  const calling = input.channel?.callingEnabled === true;
  const base = !calling
    ? "WhatsApp calling isn't switched on for this deployment (WHATSAPP_CALLING_ENABLED)."
    : eligibility.archived || !eligibility.phone.usable || eligibility.optedOut || !eligibility.sender || !eligibility.sendingAvailable
      ? (eligibility.text.reason ?? eligibility.template.reason)
      : null;
  const canCall = base === null && status === WhatsAppCallPermissionStatus.GRANTED;
  const requestReason =
    base
    ?? (status === WhatsAppCallPermissionStatus.GRANTED
      ? null
      : !eligibility.window.open
        ? "The customer hasn't messaged in the last 24 hours, so WhatsApp won't deliver a call-permission request. Ask them to message you first."
        : rateLimited
          ? "WhatsApp allows one call-permission request a day and two a week. Try again later."
          : null);
  return {
    canCall,
    canRequest: requestReason === null && status !== WhatsAppCallPermissionStatus.GRANTED,
    customerPhoneE164: eligibility.phone.e164,
    expiresAt: permission?.expiresAt ?? null,
    permanent: permission?.permanent ?? false,
    reason: canCall
      ? null
      : (base
        ?? (status === WhatsAppCallPermissionStatus.REJECTED
          ? "The customer declined WhatsApp calls."
          : status === "EXPIRED"
            ? "The customer's permission to call has expired."
            : status === WhatsAppCallPermissionStatus.REQUESTED
              ? "Waiting for the customer to allow calls."
              : "The customer hasn't allowed WhatsApp calls yet.")
        + (requestReason && base === null ? ` ${requestReason}` : "")),
    sender: eligibility.sender,
    status,
  };
}

const LEAD_FOR_PERMISSION = {
  assignedId: true,
  id: true,
  isArchived: true,
  phone: true,
  whatsappConsentAt: true,
  whatsappConsentSource: true,
  whatsappOptedOutAt: true,
} as const;

export async function leadWhatsAppCallPermission(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly now?: Date },
  db: DomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<WhatsAppCallPermissionState> {
  const now = input.now ?? new Date();
  const lead = await db.lead.findUnique({ select: LEAD_FOR_PERMISSION, where: { id: input.leadId } });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!isInternalPrincipal(principal) || !canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }
  const conversations = await db.leadWhatsAppConversation.findMany({
    select: { businessPhoneNumberId: true, customerPhoneE164: true, lastInboundAt: true, windowExpiresAt: true },
    where: { leadId: lead.id },
  });
  const first = evaluateWhatsAppCallPermission({ channel: context.channel, conversations, lead, now, permission: null });
  const permission =
    first.sender && first.customerPhoneE164
      ? await db.whatsAppCallPermission.findUnique({
          select: { expiresAt: true, permanent: true, requestedAt: true, status: true },
          where: {
            businessPhoneNumberId_customerPhoneE164: {
              businessPhoneNumberId: first.sender.phoneNumberId,
              customerPhoneE164: first.customerPhoneE164,
            },
          },
        })
      : null;
  return evaluateWhatsAppCallPermission({ channel: context.channel, conversations, lead, now, permission });
}

export function callPermissionOutboxKey(leadId: number, idempotencyKey: string) {
  return `whatsapp-call-permission:${leadId}:${idempotencyKey}`;
}

/** Send the "Allow calls" message. Once per key; refused when Meta would refuse. */
export async function requestWhatsAppCallPermission(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly idempotencyKey: string; readonly now?: Date },
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null },
): Promise<{ readonly alreadySent: boolean; readonly permission: WhatsAppCallPermissionState }> {
  const now = input.now ?? new Date();
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError("Asking to call requires a signed-in member of staff.");
  }
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 200) {
    throw new DomainValidationError("A request needs an idempotency key.", "idempotencyKey");
  }
  const port = ports.whatsapp ?? null;
  if (!port?.calls) {
    throw new DomainSideEffectError("WhatsApp calling isn't reachable from here, so nothing was sent.", "whatsapp", false);
  }
  const outboxKey = callPermissionOutboxKey(input.leadId, key);
  const existing = await db.outboxEvent.findUnique({ select: { status: true }, where: { key: outboxKey } });
  if (existing?.status === OutboxEventStatus.SUCCEEDED) {
    return {
      alreadySent: true,
      permission: await leadWhatsAppCallPermission(principal, input, db, { channel: port.channel }),
    };
  }
  const state = await leadWhatsAppCallPermission(principal, input, db, { channel: port.channel });
  if (!state.canRequest || !state.sender || !state.customerPhoneE164) {
    throw new DomainTransitionError(state.reason ?? "A call-permission request can't be sent now.");
  }
  const sender = state.sender;
  const to = state.customerPhoneE164;
  await enqueueOutboxEvent(db, {
    key: outboxKey,
    kind: OutboxEventKind.WHATSAPP_CALL_PERMISSION_REQUEST,
    payload: { from: sender.phoneNumberId, leadId: input.leadId, to },
  });
  const claimed = await claimOutboxEvent(db, outboxKey);
  if (!claimed) {
    throw new DomainTransitionError(
      `This request was already attempted and needs checking before trying again (outbox key ${outboxKey}).`,
    );
  }
  try {
    await port.calls.sendPermissionRequest({ body: PERMISSION_REQUEST_TEXT, fromPhoneNumberId: sender.phoneNumberId, to });
  } catch (error) {
    const definite = isWhatsAppSendError(error) && error.outcome === "not_sent";
    await failOutboxEvent(db, claimed.id, {
      message: definite ? "WhatsApp refused the request." : "WhatsApp did not confirm the request.",
      retryable: definite,
    });
    throw new DomainSideEffectError(
      definite
        ? `Nothing was sent: ${isWhatsAppSendError(error) ? error.message : "WhatsApp refused it."}`
        : "WhatsApp didn't confirm the request, so it hasn't been retried. Check the chat in WhatsApp before asking again.",
      "whatsapp",
      definite,
      { cause: error },
    );
  }
  await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, { sent: true });
    const where = {
      businessPhoneNumberId_customerPhoneE164: { businessPhoneNumberId: sender.phoneNumberId, customerPhoneE164: to },
    };
    const row = await tx.whatsAppCallPermission.findUnique({ select: { requestedAt: true }, where });
    await tx.whatsAppCallPermission.upsert({
      create: {
        businessPhoneNumberId: sender.phoneNumberId,
        customerPhoneE164: to,
        leadId: input.leadId,
        requestedAt: [now],
        status: WhatsAppCallPermissionStatus.REQUESTED,
      },
      // Keep the last fortnight of requests: enough for the weekly limit.
      update: {
        leadId: input.leadId,
        requestedAt: [...(row?.requestedAt ?? []).filter((at) => now.getTime() - at.getTime() < 14 * DAY_MS), now],
        status: WhatsAppCallPermissionStatus.REQUESTED,
      },
      where,
    });
    await recordWhatsAppHistory(tx, {
      action: "WhatsApp call permission requested",
      at: now,
      detail: `Asked the customer to allow WhatsApp calls from ${sender.label}.`,
      leadId: input.leadId,
      principal,
    });
  });
  return {
    alreadySent: false,
    permission: await leadWhatsAppCallPermission(principal, input, db, { channel: port.channel }),
  };
}

export type WhatsAppCallPermissionReply = {
  readonly businessPhoneNumberId: string;
  readonly fromWaId: string;
  readonly accepted: boolean;
  readonly permanent: boolean;
  readonly expiresAt: Date | null;
  readonly at: Date;
};

/** The customer tapped Allow or Decline. Only the verified webhook calls this. */
export async function recordWhatsAppCallPermissionReply(
  principal: DomainPrincipal,
  reply: WhatsAppCallPermissionReply,
  db: TransactionalDomainDb,
): Promise<"applied" | "unparseable"> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError("Only the verified WhatsApp webhook may record a permission reply.");
  }
  const customer = waIdToE164(reply.fromWaId);
  if (!customer) return "unparseable";
  return db.$transaction(async (tx) => {
    const leads = await tx.lead.findMany({ select: { id: true }, take: 2, where: { phoneE164: customer } });
    const leadId = leads.length === 1 ? leads[0].id : null;
    const status = reply.accepted ? WhatsAppCallPermissionStatus.GRANTED : WhatsAppCallPermissionStatus.REJECTED;
    const expiresAt =
      reply.accepted && !reply.permanent ? (reply.expiresAt ?? new Date(reply.at.getTime() + 7 * DAY_MS)) : null;
    await tx.whatsAppCallPermission.upsert({
      create: {
        businessPhoneNumberId: reply.businessPhoneNumberId,
        customerPhoneE164: customer,
        expiresAt,
        leadId,
        permanent: reply.accepted && reply.permanent,
        respondedAt: reply.at,
        status,
      },
      update: {
        expiresAt,
        ...(leadId ? { leadId } : {}),
        permanent: reply.accepted && reply.permanent,
        respondedAt: reply.at,
        status,
      },
      where: {
        businessPhoneNumberId_customerPhoneE164: {
          businessPhoneNumberId: reply.businessPhoneNumberId,
          customerPhoneE164: customer,
        },
      },
    });
    if (leadId) {
      await recordWhatsAppHistory(tx, {
        action: reply.accepted ? "WhatsApp calls allowed" : "WhatsApp calls declined",
        at: reply.at,
        detail: reply.accepted
          ? reply.permanent
            ? "The customer allowed WhatsApp calls."
            : "The customer allowed WhatsApp calls for the next seven days."
          : "The customer declined WhatsApp calls.",
        leadId,
        principal,
      });
    }
    return "applied" as const;
  });
}
