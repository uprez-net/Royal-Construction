import {
  CallFlowStep,
  CallStaffTarget,
  CallStatus,
  CommsDirection,
  OutboxEventKind,
  OutboxEventStatus,
  type CallContactKind,
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
  commsDefinitelyNotSent,
  isCommsError,
  type CommsChannel,
  type VoicePort,
} from "../../ports/comms";
import {
  isOfficePrincipal,
  type DomainPrincipal,
  type UserPrincipal,
} from "../../principal";
import { normaliseLeadPhone } from "../../leads/whatsapp/phone";
import { SMS_REFUSALS } from "../sms/policy";
import { resolveCallablePhone } from "../team-phones";
import {
  maskNumber,
  providerColumn,
  providerName,
  recordCommsHistory,
} from "../shared";
import { OUTBOUND_RING_SECONDS } from "./flow";
import { CALL_SELECT, toCallRecord, type CallRecord } from "./records";
import { CALL_TIME_LIMIT_SECONDS, isTerminalCallStatus } from "./state";

// Ringing a lead from the CRM: the one implementation.
//
// Server-originated, customer first (file 06 §8): the carrier rings the
// lead; when they pick up, the flow (./flow.ts) greets them, asks about
// recording if that is switched on, and puts them through to whoever pressed
// Call — their browser, or the phone they picked from the team's list
// (../team-phones.ts). A browser credential therefore
// only ever *receives* calls and can never dial an arbitrary number.
//
// Once: a click is keyed. A double click or a retry after a timeout is the
// same intent and rings the customer once. An ambiguous answer from the
// carrier is never retried — a second ring on a client's phone is the
// expensive outcome — and the call is flagged for a person.

export type RequestLeadCallInput = {
  readonly leadId: number;
  readonly idempotencyKey: string;
  readonly target: "browser" | "mobile";
  /**
   * `mobile` only: the team phone to ring. Absent means the office mobile
   * (COMMS_STAFF_FORWARD_NUMBER).
   */
  readonly phoneId?: string | null;
  readonly now?: Date;
};

export type RequestLeadCallResult = {
  readonly call: CallRecord;
  /** True when this key had already placed the call; nothing new rang. */
  readonly alreadyPlaced: boolean;
};

export const CALL_REFUSALS = {
  archived: "This lead is archived, so it can no longer be called.",
  noCalls:
    "Calling isn't available here — the phone provider isn't configured in this runtime.",
  noSender:
    "No phone number is configured for the active phone provider. An administrator needs to add one to COMMS_PHONE_NUMBERS.",
  noBrowser:
    "This phone provider can't ring a browser. Call via a phone instead.",
  noMobile:
    "No phone is set up to take calls. An admin can add the team's phones under Admin → Phone & SMS; until then, take the call in the browser.",
} as const;

export function callOutboxKey(leadId: number, idempotencyKey: string) {
  return `lead-call:${leadId}:${idempotencyKey}`;
}

export async function readCall(
  db: TransactionalDomainDb,
  where: { id: string } | { idempotencyKey: string },
) {
  const row = await db.call.findUnique({ select: CALL_SELECT, where });
  if (!row) throw new DomainNotFoundError("Call not found");
  return toCallRecord(row);
}

export async function requestLeadCall(
  principal: DomainPrincipal,
  input: RequestLeadCallInput,
  db: TransactionalDomainDb,
  ports: {
    readonly voice?: VoicePort | null;
    readonly channel?: CommsChannel | null;
  } = {},
): Promise<RequestLeadCallResult> {
  const now = input.now ?? new Date();
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Calling a lead requires a signed-in member of staff.",
    );
  }
  const outboxKey = callOutboxKey(
    input.leadId,
    requireCallKey(input.idempotencyKey),
  );

  const lead = await db.lead.findUnique({
    select: { assignedId: true, id: true, isArchived: true, phone: true },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  return placeStaffCall(
    principal,
    {
      history: async (tx, placed) => {
        await recordCommsHistory(tx, {
          action: "Call placed",
          at: now,
          detail: placedDetail(placed),
          leadId: lead.id,
          principal,
          type: "CALL",
        });
      },
      kind: OutboxEventKind.LEAD_CALL_PLACE,
      link: { leadId: lead.id },
      now,
      outboxKey,
      payload: { leadId: lead.id },
      phoneId: input.phoneId ?? null,
      resolveTo: () => {
        if (lead.isArchived) {
          throw new DomainTransitionError(CALL_REFUSALS.archived);
        }
        const phone = normaliseLeadPhone(lead.phone);
        if (!phone.usable) {
          throw new DomainTransitionError(
            phone.raw ? SMS_REFUSALS.invalidPhone : SMS_REFUSALS.noPhone,
          );
        }
        return phone.e164;
      },
      target: input.target,
    },
    db,
    ports,
  );
}

/** The key a caller sent, checked: a call without one could ring twice. */
export function requireCallKey(raw: string): string {
  const idempotencyKey = raw.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new DomainValidationError(
      "A call needs an idempotency key so a retry cannot ring the customer twice.",
      "idempotencyKey",
    );
  }
  return idempotencyKey;
}

export type PlacedCall = {
  readonly callId: string;
  readonly to: string;
  readonly sender: { readonly e164: string; readonly label: string };
  readonly staffPhone: {
    readonly e164: string;
    readonly nickname: string;
  } | null;
};

/** What a placed call's history line says, wherever it is written. */
export function placedDetail(placed: PlacedCall): string {
  return `Calling ${maskNumber(placed.to)} from ${placed.sender.label} (${placed.sender.e164}); ${
    placed.staffPhone
      ? `${placed.staffPhone.nickname} (${maskNumber(placed.staffPhone.e164)})`
      : "the caller's browser"
  } rings when they answer.`;
}

/**
 * One outbound call, however it was asked for: a lead's Call button or the
 * project dialer. Everything after "who is being rung" is one rule — the
 * replay check, the outbox claim, the carrier call and what an ambiguous
 * answer means — so it is written once, here.
 *
 * The caller has already authorised the principal for the record and turned
 * the click into an outbox key. `resolveTo` answers the number to ring or
 * throws the refusal; it runs after the replay check and the ports check, so
 * a replayed key answers with the call it placed even if the record changed.
 */
export type StaffCallPlan = {
  readonly outboxKey: string;
  readonly kind: OutboxEventKind;
  /** Extra fields for the outbox payload; provider and target are added. */
  readonly payload: Record<string, string | number | null>;
  readonly target: "browser" | "mobile";
  readonly phoneId: string | null;
  readonly now: Date;
  readonly resolveTo: () => string;
  /** What the Call row is filed against, written when it is created. */
  readonly link: {
    readonly leadId?: number | null;
    readonly projectId?: string | null;
    readonly contactKind?: CallContactKind | null;
    readonly contactName?: string | null;
    readonly contactRef?: string | null;
    readonly projectSeenAt?: Date | null;
  };
  /** The history line, written in the transaction that confirms the call. */
  readonly history: (tx: DomainDb, placed: PlacedCall) => Promise<void>;
};

export async function placeStaffCall(
  principal: UserPrincipal,
  plan: StaffCallPlan,
  db: TransactionalDomainDb,
  ports: {
    readonly voice?: VoicePort | null;
    readonly channel?: CommsChannel | null;
  },
): Promise<RequestLeadCallResult> {
  const { now, outboxKey } = plan;
  const prior = await db.call.findUnique({
    select: { id: true },
    where: { idempotencyKey: outboxKey },
  });
  if (prior) {
    const call = await readCall(db, { id: prior.id });
    if (call.needsReconciliation) {
      throw new DomainTransitionError(
        "This call may already have rung the customer — the provider never confirmed it. Check the provider's call log before calling again.",
      );
    }
    // A FAILED call may be a definite refusal whose intent was re-opened:
    // the outbox below decides whether this key may ring again.
    if (call.status !== CallStatus.FAILED) {
      return { alreadyPlaced: true, call };
    }
  }

  const voice = ports.voice ?? null;
  const channel = ports.channel ?? null;
  if (!voice || !channel?.callsAvailable) {
    throw new DomainSideEffectError(CALL_REFUSALS.noCalls, "voice", false);
  }
  const to = plan.resolveTo();
  const sender = channel.defaultNumber;
  if (!sender || sender.provider !== voice.provider) {
    throw new DomainTransitionError(CALL_REFUSALS.noSender);
  }
  if (plan.target === "browser" && !channel.browserCalling) {
    throw new DomainTransitionError(CALL_REFUSALS.noBrowser);
  }
  const staffPhone =
    plan.target === "mobile"
      ? await resolveCallablePhone(principal, plan.phoneId, channel, db)
      : null;
  if (plan.target === "mobile" && !staffPhone) {
    throw new DomainTransitionError(CALL_REFUSALS.noMobile);
  }

  const prepared = await db.$transaction(async (tx) => {
    const intent = await enqueueOutboxEvent(tx, {
      key: outboxKey,
      kind: plan.kind,
      payload: {
        ...plan.payload,
        provider: voice.provider,
        target: plan.target,
      },
    });
    if (intent.status === OutboxEventStatus.SUCCEEDED)
      return { replay: true as const };
    if (intent.status !== OutboxEventStatus.PENDING) {
      throw new DomainTransitionError(
        intent.status === OutboxEventStatus.RUNNING
          ? "This call is already being placed. Wait for it to ring."
          : `This call was already attempted and needs reconciliation before calling again (outbox key ${outboxKey}).`,
      );
    }
    // Claimed in the same transaction as the call row, so a request that
    // loses the claim writes nothing — in particular it cannot overwrite the
    // staff phone the winning request is about to ring.
    const claimed = await claimOutboxEvent(tx, outboxKey);
    if (!claimed) {
      throw new DomainTransitionError(
        "This call is already being placed. Wait for it to ring.",
      );
    }
    const fields = {
      businessNumber: sender.e164,
      customerNumber: to,
      endedAt: null,
      flowStep: CallFlowStep.DIALING_CUSTOMER,
      providerErrorCode: null,
      providerErrorTitle: null,
      // A retry after a definite refusal may switch browser <-> phone, or
      // pick another phone; the flow rings whichever this attempt asked for.
      staffPhoneLabel: staffPhone?.nickname ?? null,
      staffPhoneNumber: staffPhone?.e164 ?? null,
      staffTarget:
        plan.target === "mobile"
          ? CallStaffTarget.MOBILE
          : CallStaffTarget.BROWSER,
      startedAt: now,
      status: CallStatus.QUEUED,
    };
    const call = await tx.call.upsert({
      create: {
        ...plan.link,
        ...fields,
        direction: CommsDirection.OUTBOUND,
        idempotencyKey: outboxKey,
        provider: providerColumn(voice.provider),
        staffUserId: principal.userId,
      },
      select: { id: true },
      // Only reachable after a definite refusal: nothing rang. The link is
      // written again too, so the row always names who this attempt rings.
      update: { ...plan.link, ...fields },
      where: { idempotencyKey: outboxKey },
    });
    return { callId: call.id, claimed, replay: false as const };
  });
  if (prepared.replay) {
    return {
      alreadyPlaced: true,
      call: await readCall(db, { idempotencyKey: outboxKey }),
    };
  }

  const { claimed } = prepared;

  let providerCallId: string;
  try {
    ({ providerCallId } = await voice.placeCall({
      callId: prepared.callId,
      from: sender.e164,
      timeLimitSeconds: CALL_TIME_LIMIT_SECONDS,
      timeoutSeconds: OUTBOUND_RING_SECONDS,
      to,
    }));
  } catch (error) {
    const definite = commsDefinitelyNotSent(error);
    const failedAt = new Date();
    await db.$transaction(async (tx) => {
      await failOutboxEvent(tx, claimed.id, {
        message: definite
          ? "The provider refused the call or could not be reached; nothing rang."
          : "The provider did not confirm the call; the customer's phone may have rung.",
        retryable: definite,
      });
      await tx.call.update({
        data: definite
          ? {
              endedAt: failedAt,
              flowStep: CallFlowStep.ENDED,
              providerErrorCode: isCommsError(error)
                ? error.providerCode
                : null,
              providerErrorTitle: isCommsError(error)
                ? error.message
                : "The provider refused the call.",
              status: CallStatus.FAILED,
            }
          : {
              needsReconciliation: true,
              providerErrorTitle:
                "The provider did not confirm this call. Check its call log before calling again.",
            },
        where: { id: prepared.callId },
      });
    });
    throw new DomainSideEffectError(
      definite
        ? `The call wasn't placed: ${isCommsError(error) ? error.message : "the provider refused it."}`
        : "The phone provider didn't confirm the call, so it has not been retried. The customer's phone may be ringing — check the provider's call log before calling again.",
      "voice",
      definite,
      { cause: error },
    );
  }

  await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, {
      callId: prepared.callId,
      providerCallId,
    });
    // Callbacks can beat this write: they carry ?callId= and may already have
    // moved the status on. Only set INITIATED if nothing has.
    await tx.call.update({
      data: { providerCallId },
      where: { id: prepared.callId },
    });
    await tx.call.updateMany({
      data: { status: CallStatus.INITIATED },
      where: { id: prepared.callId, status: CallStatus.QUEUED },
    });
    await plan.history(tx, {
      callId: prepared.callId,
      sender,
      staffPhone: staffPhone
        ? { e164: staffPhone.e164, nickname: staffPhone.nickname }
        : null,
      to,
    });
  });
  return {
    alreadyPlaced: false,
    call: await readCall(db, { id: prepared.callId }),
  };
}

/**
 * Hang up a call from the CRM: cancel it while the customer's phone rings,
 * or end it once answered. The provider that placed it ends it — even if the
 * active provider has changed since.
 */
export async function endCall(
  principal: DomainPrincipal,
  input: { readonly callId: string },
  db: TransactionalDomainDb,
  ports: {
    readonly voiceFor: (provider: "twilio" | "telnyx") => VoicePort | null;
  },
): Promise<CallRecord> {
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Ending a call requires a signed-in member of staff.",
    );
  }
  const call = await db.call.findUnique({
    select: {
      id: true,
      lead: { select: { assignedId: true, id: true } },
      provider: true,
      providerCallId: true,
      status: true,
    },
    where: { id: input.callId },
  });
  if (!call) throw new DomainNotFoundError("Call not found");
  if (call.lead && !canAccessLead(principal, call.lead)) {
    throw new DomainAuthorizationError("You do not have access to this call");
  }
  if (isTerminalCallStatus(call.status)) return readCall(db, { id: call.id });
  if (!call.providerCallId) {
    throw new DomainTransitionError(
      "This call hasn't reached the provider yet, so there is nothing to hang up.",
    );
  }
  const voice = ports.voiceFor(providerName(call.provider));
  if (!voice) {
    throw new DomainSideEffectError(
      `This call is on ${providerName(call.provider)}, which isn't configured here, so it can't be ended from the app.`,
      "voice",
      false,
    );
  }
  try {
    await voice.endCall(call.providerCallId);
  } catch (error) {
    throw new DomainSideEffectError(
      `The call couldn't be ended: ${isCommsError(error) ? error.message : "the provider didn't answer."}`,
      "voice",
      true,
      { cause: error },
    );
  }
  // The status callback records how it ended; nothing is guessed here.
  return readCall(db, { id: call.id });
}
