import {
  CommsDirection,
  OutboxEventKind,
  OutboxEventStatus,
  WhatsAppCallStatus,
  type Prisma,
} from "@prisma/client";

import { canAccessLead } from "../../access/leads";
import type { DomainDb, TransactionalDomainDb } from "../../db";
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
  type WhatsAppChannel,
  type WhatsAppPort,
} from "../../ports/whatsapp";
import { isInternalPrincipal, type DomainPrincipal } from "../../principal";
import { recordWhatsAppHistory } from "./records";
import { waIdToE164 } from "./phone";
import { leadWhatsAppCallPermission } from "./call-permissions";

// WhatsApp calls, answered and placed from a staff browser (file 01 §14).
//
// Meta's Calling API carries signalling only: an inbound call arrives on the
// webhook with an SDP offer, a staff browser builds the WebRTC answer, and
// this module hands it to Meta (pre-accept, then accept). Audio flows between
// WhatsApp and the browser. WhatsApp calls can't be forwarded to a phone on
// any provider, so nobody with the app open means a missed call.
//
// One person answers: claiming a ringing call is a conditional update, so a
// second tab (or a second click) is told someone already has it.

/** Meta gives a business about this long to answer before the call drops. */
export const WHATSAPP_RING_WINDOW_MS = 45_000;

export const WHATSAPP_CALL_SELECT = {
  answeredAt: true,
  businessDisplayNumber: true,
  customerPhoneE164: true,
  direction: true,
  durationSeconds: true,
  endedAt: true,
  failureReason: true,
  id: true,
  lead: { select: { id: true, name: true } },
  needsReconciliation: true,
  remoteSdp: true,
  staffUser: { select: { name: true } },
  startedAt: true,
  status: true,
} satisfies Prisma.WhatsAppCallSelect;

type WhatsAppCallRow = Prisma.WhatsAppCallGetPayload<{
  select: typeof WHATSAPP_CALL_SELECT;
}>;

export type WhatsAppCallRecord = {
  readonly id: string;
  readonly direction: CommsDirection;
  readonly status: WhatsAppCallStatus;
  readonly leadId: number | null;
  readonly leadName: string | null;
  readonly customerPhoneE164: string;
  readonly businessDisplayNumber: string;
  readonly staffName: string | null;
  readonly startedAt: Date;
  readonly answeredAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationSeconds: number | null;
  readonly failureReason: string | null;
  readonly needsReconciliation: boolean;
  /** Meta's SDP: the offer to answer (inbound), or the answer to apply (outbound). */
  readonly remoteSdp: string | null;
};

export function toWhatsAppCallRecord(row: WhatsAppCallRow): WhatsAppCallRecord {
  return {
    answeredAt: row.answeredAt,
    businessDisplayNumber: row.businessDisplayNumber,
    customerPhoneE164: row.customerPhoneE164,
    direction: row.direction,
    durationSeconds: row.durationSeconds,
    endedAt: row.endedAt,
    failureReason: row.failureReason,
    id: row.id,
    leadId: row.lead?.id ?? null,
    leadName: row.lead?.name ?? null,
    needsReconciliation: row.needsReconciliation,
    remoteSdp: row.remoteSdp,
    staffName: row.staffUser?.name ?? null,
    startedAt: row.startedAt,
    status: row.status,
  };
}

const TERMINAL: ReadonlySet<WhatsAppCallStatus> = new Set([
  WhatsAppCallStatus.COMPLETED,
  WhatsAppCallStatus.REJECTED,
  WhatsAppCallStatus.MISSED,
  WhatsAppCallStatus.FAILED,
]);

// ── Webhook events ────────────────────────────────────────────────────

export type WhatsAppCallEvent =
  | {
      readonly kind: "connect";
      readonly providerCallId: string;
      readonly businessPhoneNumberId: string;
      /** The customer's wa_id (inbound: `from`; outbound: `to`). */
      readonly customerWaId: string;
      readonly sdpType: "offer" | "answer" | null;
      readonly sdp: string | null;
      readonly bizOpaqueCallbackData: string | null;
      readonly at: Date;
    }
  | {
      readonly kind: "status";
      readonly providerCallId: string;
      readonly status: "RINGING" | "ACCEPTED" | "REJECTED";
      readonly bizOpaqueCallbackData: string | null;
      readonly at: Date;
    }
  | {
      readonly kind: "terminate";
      readonly providerCallId: string;
      readonly status: "COMPLETED" | "FAILED";
      readonly durationSeconds: number | null;
      readonly bizOpaqueCallbackData: string | null;
      readonly at: Date;
    };

export type WhatsAppCallEventOutcome =
  | "ringing"
  | "applied"
  | "duplicate"
  | "unknown_call";

async function findByEvent(db: DomainDb, event: WhatsAppCallEvent) {
  if (event.bizOpaqueCallbackData) {
    const byId = await db.whatsAppCall.findUnique({
      select: {
        answeredAt: true,
        direction: true,
        id: true,
        leadId: true,
        providerCallId: true,
        status: true,
      },
      where: { id: event.bizOpaqueCallbackData },
    });
    if (byId) return byId;
  }
  return db.whatsAppCall.findUnique({
    select: {
      answeredAt: true,
      direction: true,
      id: true,
      leadId: true,
      providerCallId: true,
      status: true,
    },
    where: { providerCallId: event.providerCallId },
  });
}

export async function recordWhatsAppCallEvent(
  principal: DomainPrincipal,
  event: WhatsAppCallEvent,
  db: TransactionalDomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<WhatsAppCallEventOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp webhook may record a call event.",
    );
  }
  return db.$transaction(async (tx) => {
    const call = await findByEvent(tx, event);

    if (event.kind === "connect" && !call) {
      // A customer is calling Royal: the offer is what a browser answers.
      if (event.sdpType !== "offer" || !event.sdp)
        return "unknown_call" as const;
      const business = context.channel?.numbers.find(
        (n) => n.phoneNumberId === event.businessPhoneNumberId,
      );
      const customer =
        waIdToE164(event.customerWaId)
        ?? `+${event.customerWaId.replace(/\D/g, "")}`;
      const leads = await tx.lead.findMany({
        select: { id: true },
        take: 2,
        where: { phoneE164: customer },
      });
      await tx.whatsAppCall.create({
        data: {
          businessDisplayNumber:
            business?.displayNumber ?? event.businessPhoneNumberId,
          businessPhoneNumberId: event.businessPhoneNumberId,
          customerPhoneE164: customer,
          direction: CommsDirection.INBOUND,
          leadId: leads.length === 1 ? leads[0].id : null,
          providerCallId: event.providerCallId,
          remoteSdp: event.sdp,
          startedAt: event.at,
          status: WhatsAppCallStatus.RINGING,
        },
      });
      return "ringing" as const;
    }
    if (!call) return "unknown_call" as const;
    if (TERMINAL.has(call.status) && event.kind !== "terminate")
      return "duplicate" as const;

    switch (event.kind) {
      case "connect": {
        // Outbound: the customer picked up and Meta sent its SDP answer.
        if (
          call.direction !== CommsDirection.OUTBOUND
          || event.sdpType !== "answer"
        )
          return "duplicate" as const;
        await tx.whatsAppCall.update({
          data: {
            answeredAt: call.answeredAt ?? event.at,
            providerCallId: call.providerCallId ?? event.providerCallId,
            remoteSdp: event.sdp,
            status: WhatsAppCallStatus.ACCEPTED,
          },
          where: { id: call.id },
        });
        return "applied" as const;
      }
      case "status": {
        if (event.status === "REJECTED") {
          await tx.whatsAppCall.update({
            data: { endedAt: event.at, status: WhatsAppCallStatus.REJECTED },
            where: { id: call.id },
          });
          if (call.leadId) {
            await recordWhatsAppHistory(tx, {
              action: "WhatsApp call declined",
              at: event.at,
              detail: "The customer declined a WhatsApp call.",
              leadId: call.leadId,
              principal,
            });
          }
        } else if (
          event.status === "ACCEPTED"
          && call.status === WhatsAppCallStatus.RINGING
        ) {
          await tx.whatsAppCall.update({
            data: {
              answeredAt: call.answeredAt ?? event.at,
              status: WhatsAppCallStatus.ACCEPTED,
            },
            where: { id: call.id },
          });
        }
        return "applied" as const;
      }
      case "terminate": {
        if (
          TERMINAL.has(call.status)
          && call.status !== WhatsAppCallStatus.COMPLETED
        )
          return "duplicate" as const;
        const answered =
          call.status === WhatsAppCallStatus.ACCEPTED
          || call.status === WhatsAppCallStatus.COMPLETED;
        const status = answered
          ? WhatsAppCallStatus.COMPLETED
          : event.status === "FAILED"
            ? WhatsAppCallStatus.FAILED
            : WhatsAppCallStatus.MISSED;
        await tx.whatsAppCall.update({
          data: {
            durationSeconds: event.durationSeconds,
            endedAt: event.at,
            remoteSdp: null,
            status,
          },
          where: { id: call.id },
        });
        if (call.leadId && call.status !== WhatsAppCallStatus.COMPLETED) {
          const inbound = call.direction === CommsDirection.INBOUND;
          await recordWhatsAppHistory(tx, {
            action: answered
              ? "WhatsApp call"
              : inbound
                ? "Missed WhatsApp call"
                : "WhatsApp call not answered",
            at: event.at,
            detail: answered
              ? `${inbound ? "Incoming" : "Outgoing"} WhatsApp call lasted ${event.durationSeconds ?? 0}s.`
              : inbound
                ? "The customer called on WhatsApp and nobody answered."
                : "The customer didn't answer a WhatsApp call.",
            leadId: call.leadId,
            principal,
          });
        }
        return "applied" as const;
      }
    }
  });
}

// ── Staff actions ─────────────────────────────────────────────────────

function requireStaff(principal: DomainPrincipal) {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "WhatsApp calls are for signed-in members of staff.",
    );
  }
  return principal;
}

async function readCall(db: DomainDb, id: string): Promise<WhatsAppCallRecord> {
  const row = await db.whatsAppCall.findUnique({
    select: WHATSAPP_CALL_SELECT,
    where: { id },
  });
  if (!row) throw new DomainNotFoundError("Call not found");
  return toWhatsAppCallRecord(row);
}

function sideEffect(error: unknown, what: string): DomainSideEffectError {
  const definite = isWhatsAppSendError(error) && error.outcome === "not_sent";
  return new DomainSideEffectError(
    `${what}: ${isWhatsAppSendError(error) ? error.message : "WhatsApp didn't answer."}`,
    "whatsapp",
    definite,
    { cause: error },
  );
}

/** Customers calling now, that nobody has picked up. */
export async function ringingWhatsAppCalls(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
): Promise<WhatsAppCallRecord[]> {
  requireStaff(principal);
  const rows = await db.whatsAppCall.findMany({
    orderBy: { startedAt: "asc" },
    select: WHATSAPP_CALL_SELECT,
    take: 5,
    where: {
      direction: CommsDirection.INBOUND,
      staffUserId: null,
      startedAt: { gte: new Date(now.getTime() - WHATSAPP_RING_WINDOW_MS) },
      status: WhatsAppCallStatus.RINGING,
    },
  });
  return rows.map(toWhatsAppCallRecord);
}

export async function getWhatsAppCall(
  principal: DomainPrincipal,
  input: { readonly callId: string },
  db: DomainDb,
): Promise<WhatsAppCallRecord> {
  requireStaff(principal);
  const call = await readCall(db, input.callId);
  if (call.leadId) {
    const lead = await db.lead.findUnique({
      select: { assignedId: true, id: true },
      where: { id: call.leadId },
    });
    if (lead && !canAccessLead(principal, lead))
      throw new DomainNotFoundError("Call not found");
  }
  return call;
}

const MAX_SDP = 20_000;

function validSdp(sdp: string, field: string): string {
  const value = sdp.trim();
  if (!value.startsWith("v=0") || value.length > MAX_SDP) {
    throw new DomainValidationError(
      "The browser's call description is not valid SDP.",
      field,
    );
  }
  return value;
}

/** Answer a ringing customer with the browser's SDP answer. */
export async function answerWhatsAppCall(
  principal: DomainPrincipal,
  input: {
    readonly callId: string;
    readonly sdpAnswer: string;
    readonly now?: Date;
  },
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null },
): Promise<WhatsAppCallRecord> {
  const staff = requireStaff(principal);
  const now = input.now ?? new Date();
  const sdpAnswer = validSdp(input.sdpAnswer, "sdpAnswer");
  const calls = ports.whatsapp?.calls;
  if (!calls)
    throw new DomainSideEffectError(
      "WhatsApp calling isn't reachable from here.",
      "whatsapp",
      false,
    );
  const call = await db.whatsAppCall.findUnique({
    select: {
      businessPhoneNumberId: true,
      direction: true,
      id: true,
      providerCallId: true,
      startedAt: true,
      status: true,
    },
    where: { id: input.callId },
  });
  if (
    !call
    || call.direction !== CommsDirection.INBOUND
    || !call.providerCallId
  ) {
    throw new DomainNotFoundError("Call not found");
  }
  if (
    call.status !== WhatsAppCallStatus.RINGING
    || now.getTime() - call.startedAt.getTime() > WHATSAPP_RING_WINDOW_MS * 2
  ) {
    throw new DomainTransitionError("This call has already ended.");
  }
  // Claim it: only one browser answers.
  const claimed = await db.whatsAppCall.updateMany({
    data: { staffUserId: staff.userId },
    where: {
      id: call.id,
      staffUserId: null,
      status: WhatsAppCallStatus.RINGING,
    },
  });
  if (claimed.count !== 1)
    throw new DomainTransitionError(
      "Someone else has already answered this call.",
    );
  const target = {
    fromPhoneNumberId: call.businessPhoneNumberId,
    providerCallId: call.providerCallId,
    sdpAnswer,
  };
  try {
    await calls.preAccept(target);
    await calls.accept(target);
  } catch (error) {
    await db.whatsAppCall.update({
      data: {
        endedAt: now,
        failureReason: isWhatsAppSendError(error)
          ? error.message
          : "WhatsApp didn't accept the answer.",
        status: WhatsAppCallStatus.FAILED,
      },
      where: { id: call.id },
    });
    throw sideEffect(error, "The call couldn't be answered");
  }
  await db.whatsAppCall.update({
    data: {
      answeredAt: now,
      remoteSdp: null,
      status: WhatsAppCallStatus.ACCEPTED,
    },
    where: { id: call.id },
  });
  return readCall(db, call.id);
}

export async function rejectWhatsAppCall(
  principal: DomainPrincipal,
  input: { readonly callId: string },
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null },
): Promise<WhatsAppCallRecord> {
  requireStaff(principal);
  const calls = ports.whatsapp?.calls;
  if (!calls)
    throw new DomainSideEffectError(
      "WhatsApp calling isn't reachable from here.",
      "whatsapp",
      false,
    );
  const call = await db.whatsAppCall.findUnique({
    select: {
      businessPhoneNumberId: true,
      id: true,
      providerCallId: true,
      status: true,
    },
    where: { id: input.callId },
  });
  if (!call?.providerCallId) throw new DomainNotFoundError("Call not found");
  if (call.status !== WhatsAppCallStatus.RINGING) return readCall(db, call.id);
  try {
    await calls.reject({
      fromPhoneNumberId: call.businessPhoneNumberId,
      providerCallId: call.providerCallId,
    });
  } catch (error) {
    throw sideEffect(error, "The call couldn't be declined");
  }
  await db.whatsAppCall.update({
    data: {
      endedAt: new Date(),
      remoteSdp: null,
      status: WhatsAppCallStatus.REJECTED,
    },
    where: { id: call.id },
  });
  return readCall(db, call.id);
}

/** Hang up an answered call, or cancel an outbound one that is still ringing. */
export async function endWhatsAppCall(
  principal: DomainPrincipal,
  input: { readonly callId: string },
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null },
): Promise<WhatsAppCallRecord> {
  requireStaff(principal);
  const calls = ports.whatsapp?.calls;
  if (!calls)
    throw new DomainSideEffectError(
      "WhatsApp calling isn't reachable from here.",
      "whatsapp",
      false,
    );
  const call = await db.whatsAppCall.findUnique({
    select: {
      businessPhoneNumberId: true,
      id: true,
      providerCallId: true,
      status: true,
    },
    where: { id: input.callId },
  });
  if (!call) throw new DomainNotFoundError("Call not found");
  if (TERMINAL.has(call.status) || !call.providerCallId)
    return readCall(db, call.id);
  try {
    await calls.terminate({
      fromPhoneNumberId: call.businessPhoneNumberId,
      providerCallId: call.providerCallId,
    });
  } catch (error) {
    throw sideEffect(error, "The call couldn't be ended");
  }
  // The terminate webhook records how long it lasted.
  return readCall(db, call.id);
}

export function whatsappCallOutboxKey(leadId: number, idempotencyKey: string) {
  return `whatsapp-call:${leadId}:${idempotencyKey}`;
}

/** Ring a customer on WhatsApp with the browser's SDP offer. Needs their permission. */
export async function startWhatsAppCall(
  principal: DomainPrincipal,
  input: {
    readonly leadId: number;
    readonly idempotencyKey: string;
    readonly sdpOffer: string;
    readonly now?: Date;
  },
  db: TransactionalDomainDb,
  ports: { readonly whatsapp?: WhatsAppPort | null },
): Promise<{
  readonly call: WhatsAppCallRecord;
  readonly alreadyPlaced: boolean;
}> {
  const staff = requireStaff(principal);
  const now = input.now ?? new Date();
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 200)
    throw new DomainValidationError(
      "A call needs an idempotency key.",
      "idempotencyKey",
    );
  const sdpOffer = validSdp(input.sdpOffer, "sdpOffer");
  const port = ports.whatsapp ?? null;
  if (!port?.calls)
    throw new DomainSideEffectError(
      "WhatsApp calling isn't reachable from here.",
      "whatsapp",
      false,
    );
  const outboxKey = whatsappCallOutboxKey(input.leadId, key);
  const prior = await db.whatsAppCall.findUnique({
    select: { id: true },
    where: { idempotencyKey: outboxKey },
  });
  if (prior) return { alreadyPlaced: true, call: await readCall(db, prior.id) };

  const permission = await leadWhatsAppCallPermission(principal, input, db, {
    channel: port.channel,
  });
  if (
    !permission.canCall
    || !permission.sender
    || !permission.customerPhoneE164
  ) {
    throw new DomainTransitionError(
      permission.reason ?? "This customer can't be called on WhatsApp now.",
    );
  }
  const sender = permission.sender;
  const to = permission.customerPhoneE164;

  const prepared = await db.$transaction(async (tx) => {
    const intent = await enqueueOutboxEvent(tx, {
      key: outboxKey,
      kind: OutboxEventKind.WHATSAPP_CALL_CONNECT,
      payload: { from: sender.phoneNumberId, leadId: input.leadId, to },
    });
    if (intent.status !== OutboxEventStatus.PENDING) {
      throw new DomainTransitionError(
        `This call was already attempted (outbox key ${outboxKey}).`,
      );
    }
    return tx.whatsAppCall.create({
      data: {
        businessDisplayNumber: sender.displayNumber,
        businessPhoneNumberId: sender.phoneNumberId,
        customerPhoneE164: to,
        direction: CommsDirection.OUTBOUND,
        idempotencyKey: outboxKey,
        leadId: input.leadId,
        staffUserId: staff.userId,
        startedAt: now,
        status: WhatsAppCallStatus.RINGING,
      },
      select: { id: true },
    });
  });
  const claimed = await claimOutboxEvent(db, outboxKey);
  if (!claimed)
    throw new DomainTransitionError("This call is already being placed.");
  let providerCallId: string;
  try {
    ({ providerCallId } = await port.calls.connect({
      bizOpaqueCallbackData: prepared.id,
      fromPhoneNumberId: sender.phoneNumberId,
      sdpOffer,
      to,
    }));
  } catch (error) {
    const definite = isWhatsAppSendError(error) && error.outcome === "not_sent";
    await db.$transaction(async (tx) => {
      await failOutboxEvent(tx, claimed.id, {
        message: definite
          ? "WhatsApp refused the call."
          : "WhatsApp did not confirm the call.",
        retryable: false,
      });
      await tx.whatsAppCall.update({
        data: definite
          ? {
              endedAt: new Date(),
              failureReason: isWhatsAppSendError(error)
                ? error.message
                : "WhatsApp refused the call.",
              status: WhatsAppCallStatus.FAILED,
            }
          : {
              needsReconciliation: true,
              failureReason: "WhatsApp didn't confirm the call.",
            },
        where: { id: prepared.id },
      });
    });
    throw sideEffect(error, "The WhatsApp call wasn't placed");
  }
  await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, {
      callId: prepared.id,
      providerCallId,
    });
    await tx.whatsAppCall.update({
      data: { providerCallId },
      where: { id: prepared.id },
    });
    await recordWhatsAppHistory(tx, {
      action: "WhatsApp call placed",
      at: now,
      detail: `Calling the customer on WhatsApp from ${sender.label}.`,
      leadId: input.leadId,
      principal,
    });
  });
  return { alreadyPlaced: false, call: await readCall(db, prepared.id) };
}
