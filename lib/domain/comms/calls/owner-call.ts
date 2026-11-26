import {
  CallStaffTarget,
  CallStatus,
  CommsDirection,
  OutboxEventKind,
  OwnerCallStatus,
  type OwnerCallHandoffStatus,
  Prisma,
  type CallFlowStep,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "../../errors";
import type { CommsChannel, VoicePort } from "../../ports/comms";
import type { OwnerAssistantPort } from "../../ports/owner-assistant";
import {
  describePrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../../principal";
import type { VoiceCallAuthority } from "../callers/identity";
import { isBusinessNumber, readOwnerLine } from "../owner-line";
import { maskNumber } from "../shared";
import {
  AGENT_CALL_EVENT,
  recordAgentCallEvent,
  toAgentCallEventRecord,
  type AgentCallEventRecord,
} from "./agent-events";
import { placeStaffCall, readCall, requireCallKey } from "./outbound";
import {
  handoffForCallback,
  readHandoffForOwnerCall,
  reopenHandoffForFailedCallback,
  resolveHandoffByCallback,
  type OwnerCallHandoffSummary,
} from "./owner-call-handoff";
import type { CallRecord } from "./records";
import {
  ASK_HERMES_ANSWER_MAX_CHARS,
  ASK_HERMES_MAX_PER_CALL,
  ASK_HERMES_QUESTION_MAX_CHARS,
  isOwnerCallCategory,
  OWNER_CALL_CATEGORIES,
  type OwnerCallCategory,
  type OwnerCallVoiceBriefing,
} from "./voice-agent-owner-call";

// Mili ringing the owner for Hermes: the one implementation.
//
// Hermes — the owner's personal assistant, on its own server — calls the
// schedule_owner_call tool on the operations agent's MCP channel
// (agent/tools/owner_calls.ts, offered to Hermes only) with what the call is
// about and, optionally, when. That is an OwnerCall: SCHEDULED until it is
// due, then placed on the owner line (../owner-line.ts) by this file —
// straight away for "now", or by its timer (lib/workflow/owner-call.ts, a
// durable sleep, so nothing polls the database) for a later time. When
// the owner picks up, the call router (flow.ts) hands the call to Mili, who
// opens with the briefing (voice-agent-owner-call.ts). Nobody on the team is
// rung. Every step is logged as an AgentCallEvent (agent-events.ts).
//
// The number is never Hermes's to choose: always the owner line an admin set,
// so a leaked Hermes secret can ring the owner and nobody else. One call at a
// time and an hourly cap bound even that.
//
// Once: every request carries Hermes's idempotency key, unique on the
// OwnerCall. A retried tool call answers with the request it made; a request
// is placed under its own outbox key, so a cron run and an immediate request
// racing for it ring once. An ambiguous carrier answer is never retried.

export const OWNER_CALL_LIMITS = {
  agendaItemMaxChars: 300,
  agendaMaxItems: 12,
  contextMaxChars: 12_000,
  referenceMaxChars: 200,
  subjectMaxChars: 160,
  /** Briefing calls rung in the last hour, at most. */
  perHour: 6,
  /** How far ahead a call may be scheduled. */
  scheduleMaxDays: 60,
  /**
   * A scheduled call still held up (Mili busy, the cap) this long after its
   * time is not rung late: a reminder for a meeting that has started is noise.
   */
  missedAfterMinutes: 30,
} as const;

/** A time this close to now is "now". */
const NOW_WINDOW_MS = 30_000;
/** A call to the owner not settled after this long no longer blocks the next. */
const STALE_LIVE_CALL_MS = 20 * 60 * 1000;
/**
 * A claim still PLACING after this long was abandoned mid-placement (a
 * database failure, a function cut off): placing never takes this long.
 */
const STALE_PLACING_MS = 15 * 60 * 1000;
/** Held while a placement checks the limits and reserves its call row. */
const PLACE_LOCK_KEY = "owner-call:place";

export const OWNER_CALL_REFUSALS = {
  noLine:
    "No owner line is set, so there is nobody for Mili to ring. An admin can set it under Admin → Phone & SMS.",
  busy: "Mili is already on a call to the owner. Try again once it has finished, or schedule it with call_at.",
  tooMany: `Mili has rung the owner ${OWNER_CALL_LIMITS.perHour} times in the last hour. Try again later, or put the rest in one call.`,
  missed: `Mili couldn't ring within ${OWNER_CALL_LIMITS.missedAfterMinutes} minutes of the scheduled time (she was busy or the hourly limit was reached), so the call was dropped.`,
  businessNumber:
    "The owner line is now one of the business numbers, so Mili won't ring it. An admin can change it under Admin → Phone & SMS.",
  uncertain:
    "Placing this call was interrupted and the carrier never confirmed it, so it may have rung. Check the carrier's call log; it won't be rung again.",
  notScheduled:
    "This call has already rung (or was cancelled), so it can no longer be cancelled.",
} as const;

export type RequestOwnerCallInput = {
  /** Required: a retried request must not ring the owner twice. */
  readonly idempotencyKey: string;
  readonly category: string;
  readonly subject: string;
  readonly agenda: readonly string[];
  readonly context: string;
  /** The requester's own id for this (a Hermes task or calendar event). */
  readonly reference?: string | null;
  /** When the event the call is about starts, if it is about one. */
  readonly eventAt?: Date | null;
  /** When to ring. Absent, past or within half a minute: now. */
  readonly callAt?: Date | null;
  /**
   * The post-call handoff this is the callback for (owner-call-handoff.ts).
   * One callback per handoff: a second request for it answers with the first.
   */
  readonly handoffId?: string | null;
  readonly now?: Date;
};

/** The call itself, once it has rung. */
export type OwnerCallLeg = {
  readonly callId: string;
  readonly status: CallStatus;
  readonly flowStep: CallFlowStep;
  readonly answered: boolean;
  readonly answeredAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationSeconds: number | null;
  /** The provider may have rung the owner but never confirmed it. */
  readonly needsReconciliation: boolean;
  readonly problem: string | null;
  /** What the owner and Mili said, one "Speaker: text" line per turn. */
  readonly transcript: string | null;
  readonly recordings: readonly {
    readonly id: string;
    readonly available: boolean;
    readonly transcript: string | null;
  }[];
};

export type OwnerCallSummary = {
  readonly id: string;
  readonly status: OwnerCallStatus;
  readonly callAt: Date;
  readonly placedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly failureReason: string | null;
  readonly source: string;
  readonly category: string;
  readonly subject: string;
  readonly reference: string | null;
  readonly eventAt: Date | null;
  readonly questionsAsked: number;
  /** The owner line it rang, masked; null until it rang. */
  readonly to: string | null;
  readonly call: OwnerCallLeg | null;
  /** The handoff this call is the callback for, if it is one. */
  readonly fromHandoffId: string | null;
  /** What this call left for Hermes once it ended, if anything yet. */
  readonly handoff: {
    readonly id: string;
    readonly status: OwnerCallHandoffStatus;
  } | null;
  readonly createdAt: Date;
};

export type OwnerCallDetail = OwnerCallSummary & {
  readonly agenda: readonly string[];
  readonly context: string;
  /** The full call record (recordings and all), once it has rung. */
  readonly callRecord: CallRecord | null;
  readonly events: readonly AgentCallEventRecord[];
  /** What the call left for Hermes, request by request. */
  readonly handoffDetail: OwnerCallHandoffSummary | null;
};

export type RequestOwnerCallResult = {
  readonly ownerCall: OwnerCallSummary;
  /** True when this key had already made the request; nothing new was done. */
  readonly alreadyRequested: boolean;
};

export type PlaceOwnerCallOutcome =
  | "placed"
  | "deferred"
  | "failed"
  /** Not SCHEDULED any more (placed elsewhere, cancelled): nothing done. */
  | "skipped";

export function ownerCallOutboxKey(ownerCallId: string): string {
  return `owner-call:${ownerCallId}`;
}

// ── Reading ─────────────────────────────────────────────────────────────

const SUMMARY_SELECT = {
  callAt: true,
  canceledAt: true,
  category: true,
  createdAt: true,
  eventAt: true,
  failureReason: true,
  fromHandoffId: true,
  handoff: { select: { id: true, status: true } },
  id: true,
  placedAt: true,
  questionsAsked: true,
  reference: true,
  source: true,
  status: true,
  subject: true,
  call: {
    select: {
      agentTranscript: true,
      answeredBy: true,
      answeredAt: true,
      customerNumber: true,
      durationSeconds: true,
      endedAt: true,
      flowStep: true,
      id: true,
      needsReconciliation: true,
      providerErrorTitle: true,
      recordings: {
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, transcript: true },
      },
      status: true,
    },
  },
} satisfies Prisma.OwnerCallSelect;

type SummaryRow = Prisma.OwnerCallGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(row: SummaryRow): OwnerCallSummary {
  const call = row.call;
  return {
    call: call
      ? {
          answered: call.answeredBy !== null,
          answeredAt: call.answeredAt,
          callId: call.id,
          durationSeconds: call.durationSeconds,
          endedAt: call.endedAt,
          flowStep: call.flowStep,
          needsReconciliation: call.needsReconciliation,
          problem: call.providerErrorTitle,
          recordings: call.recordings.map((recording) => ({
            available: recording.status === "STORED",
            id: recording.id,
            transcript: recording.transcript,
          })),
          status: call.status,
          transcript: call.agentTranscript,
        }
      : null,
    callAt: row.callAt,
    canceledAt: row.canceledAt,
    category: row.category,
    createdAt: row.createdAt,
    eventAt: row.eventAt,
    failureReason: row.failureReason,
    fromHandoffId: row.fromHandoffId ?? null,
    handoff: row.handoff ?? null,
    id: row.id,
    placedAt: row.placedAt,
    questionsAsked: row.questionsAsked,
    reference: row.reference,
    source: row.source,
    status: row.status,
    subject: row.subject,
    to: call ? maskNumber(call.customerNumber) : null,
  };
}

async function summaryById(
  db: DomainDb,
  ownerCallId: string,
): Promise<OwnerCallSummary> {
  const row = await db.ownerCall.findUnique({
    select: SUMMARY_SELECT,
    where: { id: ownerCallId },
  });
  if (!row) throw new DomainNotFoundError("That owner call was not found.");
  return toSummary(row);
}

/** One owner call, for Hermes or an admin. Never any other call. */
export async function readOwnerCall(
  principal: DomainPrincipal,
  input: { readonly ownerCallId: string },
  db: DomainDb,
): Promise<OwnerCallSummary> {
  requireAdminPrincipal(principal);
  return summaryById(db, input.ownerCallId);
}

/**
 * The admin's list: everything still to ring (soonest first), then the most
 * recent that have rung, failed or been cancelled.
 */
export async function listOwnerCalls(
  principal: DomainPrincipal,
  db: DomainDb,
  input: { readonly recentLimit?: number } = {},
): Promise<{
  readonly pending: readonly OwnerCallSummary[];
  readonly recent: readonly OwnerCallSummary[];
}> {
  requireAdminPrincipal(principal);
  const open = [OwnerCallStatus.SCHEDULED, OwnerCallStatus.PLACING];
  const [pending, recent] = await Promise.all([
    db.ownerCall.findMany({
      orderBy: { callAt: "asc" },
      select: SUMMARY_SELECT,
      take: 200,
      where: { status: { in: open } },
    }),
    db.ownerCall.findMany({
      orderBy: { createdAt: "desc" },
      select: SUMMARY_SELECT,
      take: Math.min(Math.max(input.recentLimit ?? 50, 1), 200),
      where: { status: { notIn: open } },
    }),
  ]);
  return { pending: pending.map(toSummary), recent: recent.map(toSummary) };
}

/** How many owner calls are still to ring, and how many failed today. Admin. */
export async function countOwnerCalls(
  principal: DomainPrincipal,
  db: DomainDb,
  input: { readonly now?: Date } = {},
): Promise<{ readonly pending: number; readonly failedToday: number }> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const [pending, failedToday] = await Promise.all([
    db.ownerCall.count({
      where: {
        status: { in: [OwnerCallStatus.SCHEDULED, OwnerCallStatus.PLACING] },
      },
    }),
    db.ownerCall.count({
      where: {
        status: OwnerCallStatus.FAILED,
        updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  return { failedToday, pending };
}

/** One owner call with its briefing, its call record and every event. Admin. */
export async function readOwnerCallDetail(
  principal: DomainPrincipal,
  input: { readonly ownerCallId: string },
  db: TransactionalDomainDb,
): Promise<OwnerCallDetail> {
  requireAdminPrincipal(principal);
  const row = await db.ownerCall.findUnique({
    select: {
      ...SUMMARY_SELECT,
      agenda: true,
      context: true,
      events: {
        orderBy: { occurredAt: "asc" },
        select: { detail: true, id: true, kind: true, occurredAt: true },
      },
    },
    where: { id: input.ownerCallId },
  });
  if (!row) throw new DomainNotFoundError("That owner call was not found.");
  // The desk's events on the call are filed on both; read them once.
  const callEvents = row.call
    ? await db.agentCallEvent.findMany({
        orderBy: { occurredAt: "asc" },
        select: { detail: true, id: true, kind: true, occurredAt: true },
        where: { callId: row.call.id, ownerCallId: null },
      })
    : [];
  const events = [...row.events, ...callEvents]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map(toAgentCallEventRecord);
  return {
    ...toSummary(row),
    agenda: row.agenda,
    callRecord: row.call ? await readCall(db, { id: row.call.id }) : null,
    context: row.context,
    events,
    handoffDetail: row.handoff
      ? await readHandoffForOwnerCall(principal, { ownerCallId: row.id }, db)
      : null,
  };
}

// ── Asking ──────────────────────────────────────────────────────────────

type CleanBriefing = {
  readonly category: OwnerCallCategory;
  readonly subject: string;
  readonly agenda: string[];
  readonly context: string;
  readonly reference: string | null;
  readonly eventAt: Date | null;
};

function oneLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** The briefing as the business takes it: bounded, so it fits a phone call. */
function cleanBriefing(input: RequestOwnerCallInput): CleanBriefing {
  const L = OWNER_CALL_LIMITS;
  if (!isOwnerCallCategory(input.category)) {
    throw new DomainValidationError(
      `category must be one of ${OWNER_CALL_CATEGORIES.join(", ")}.`,
      "category",
    );
  }
  const subject = oneLine(input.subject);
  if (!subject) {
    throw new DomainValidationError("Give the call a subject.", "subject");
  }
  if (subject.length > L.subjectMaxChars) {
    throw new DomainValidationError(
      `Keep the subject to ${L.subjectMaxChars} characters.`,
      "subject",
    );
  }
  const agenda = input.agenda.map(oneLine).filter(Boolean);
  if (agenda.length > L.agendaMaxItems) {
    throw new DomainValidationError(
      `Keep the agenda to ${L.agendaMaxItems} points; put the detail in the context.`,
      "agenda",
    );
  }
  if (agenda.some((item) => item.length > L.agendaItemMaxChars)) {
    throw new DomainValidationError(
      `Keep each agenda point to ${L.agendaItemMaxChars} characters; put the detail in the context.`,
      "agenda",
    );
  }
  const context = input.context.trim();
  if (context.length > L.contextMaxChars) {
    throw new DomainValidationError(
      `Keep the context to ${L.contextMaxChars} characters: it is read on a phone call.`,
      "context",
    );
  }
  if (!context && agenda.length === 0) {
    throw new DomainValidationError(
      "Give Mili something to say: an agenda, a context, or both.",
      "context",
    );
  }
  const reference = input.reference ? oneLine(input.reference) : null;
  if (reference && reference.length > L.referenceMaxChars) {
    throw new DomainValidationError(
      `Keep the reference to ${L.referenceMaxChars} characters.`,
      "reference",
    );
  }
  const eventAt = input.eventAt ?? null;
  if (eventAt && Number.isNaN(eventAt.getTime())) {
    throw new DomainValidationError("eventAt is not a date.", "eventAt");
  }
  return {
    agenda,
    category: input.category,
    context,
    eventAt,
    reference: reference || null,
    subject,
  };
}

/** When to ring, or null for now. */
function cleanCallAt(raw: Date | null | undefined, now: Date): Date | null {
  if (!raw) return null;
  if (Number.isNaN(raw.getTime())) {
    throw new DomainValidationError("call_at is not a date.", "callAt");
  }
  if (raw.getTime() <= now.getTime() + NOW_WINDOW_MS) return null;
  const latest =
    now.getTime() + OWNER_CALL_LIMITS.scheduleMaxDays * 24 * 60 * 60 * 1000;
  if (raw.getTime() > latest) {
    throw new DomainValidationError(
      `A call can be scheduled up to ${OWNER_CALL_LIMITS.scheduleMaxDays} days ahead.`,
      "callAt",
    );
  }
  return raw;
}

/**
 * Why Mili may not ring the owner now, or null: she is already on a call to
 * them, or has rung OWNER_CALL_LIMITS.perHour times in the last hour.
 */
async function ownerCallBlocker(
  db: DomainDb,
  now: Date,
  /** The call row this placement has just reserved, not counted against it. */
  exceptCallId?: string,
): Promise<string | null> {
  const owned = {
    direction: CommsDirection.OUTBOUND,
    staffTarget: CallStaffTarget.AGENT,
    ...(exceptCallId ? { id: { not: exceptCallId } } : {}),
  };
  const [live, lastHour] = await Promise.all([
    db.call.count({
      where: {
        ...owned,
        startedAt: { gte: new Date(now.getTime() - STALE_LIVE_CALL_MS) },
        status: {
          in: [
            CallStatus.QUEUED,
            CallStatus.INITIATED,
            CallStatus.RINGING,
            CallStatus.IN_PROGRESS,
          ],
        },
      },
    }),
    db.call.count({
      where: {
        ...owned,
        startedAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
        status: { not: CallStatus.FAILED },
      },
    }),
  ]);
  if (live > 0) return OWNER_CALL_REFUSALS.busy;
  if (lastHour >= OWNER_CALL_LIMITS.perHour) return OWNER_CALL_REFUSALS.tooMany;
  return null;
}

/**
 * The limits failed when checked again inside the transaction that reserves
 * the call row (placeOwnerCall's `prepare`). Thrown to roll that transaction
 * back, so nothing of the attempt is kept.
 */
class OwnerCallHeldError extends DomainTransitionError {}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
  );
}

type Ports = {
  readonly voice?: VoicePort | null;
  readonly channel?: CommsChannel | null;
};

/**
 * Ask Mili to ring the owner: now, or at `callAt`. ADMIN or a trusted
 * system channel (Hermes, authenticated by its secret).
 *
 * "Now" is held to the owner line, one call at a time and the hourly cap
 * before anything is written, so a refusal leaves the key free to try again.
 * A scheduled call is checked for the owner line now (so Hermes hears of a
 * missing one at once) and for the rest when it is due.
 */
export async function requestOwnerCall(
  principal: DomainPrincipal,
  input: RequestOwnerCallInput,
  db: TransactionalDomainDb,
  ports: Ports = {},
): Promise<RequestOwnerCallResult> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const idempotencyKey = requireCallKey(input.idempotencyKey);
  const briefing = cleanBriefing(input);
  const callAt = cleanCallAt(input.callAt, now);

  const existing = await db.ownerCall.findUnique({
    select: { id: true },
    where: { idempotencyKey },
  });
  if (existing) {
    return {
      alreadyRequested: true,
      ownerCall: await summaryById(db, existing.id),
    };
  }

  const handoffId = input.handoffId?.trim() || null;
  if (handoffId) {
    const { existingCallbackId } = await handoffForCallback(db, handoffId);
    if (existingCallbackId) {
      return {
        alreadyRequested: true,
        ownerCall: await summaryById(db, existingCallbackId),
      };
    }
  }

  if (!(await readOwnerLine(db))) {
    throw new DomainTransitionError(OWNER_CALL_REFUSALS.noLine);
  }
  if (!callAt) {
    const blocker = await ownerCallBlocker(db, now);
    if (blocker) {
      // A copy of this request may have landed (and be ringing) since the
      // key was read: that copy is the busy call, so answer with it.
      const landed = await db.ownerCall.findUnique({
        select: { id: true },
        where: { idempotencyKey },
      });
      if (landed) {
        return {
          alreadyRequested: true,
          ownerCall: await summaryById(db, landed.id),
        };
      }
      throw new DomainTransitionError(blocker);
    }
  }

  const source = principal.kind === "system" ? principal.reason : "app";
  let ownerCallId: string;
  try {
    ownerCallId = await db.$transaction(async (tx) => {
      const created = await tx.ownerCall.create({
        data: {
          ...briefing,
          callAt: callAt ?? now,
          fromHandoffId: handoffId,
          idempotencyKey,
          source,
          status: OwnerCallStatus.SCHEDULED,
        },
        select: { id: true },
      });
      if (handoffId) {
        // Scheduling the callback is what resolves the handoff; a failed
        // ring reopens it (reopenHandoffForFailedCallback).
        await resolveHandoffByCallback(tx, {
          callAt: callAt ?? now,
          callbackOwnerCallId: created.id,
          handoffId,
          now,
        });
      }
      await recordAgentCallEvent(
        tx,
        { ownerCallId: created.id },
        {
          at: now,
          detail: {
            by: describePrincipal(principal),
            callAt: (callAt ?? now).toISOString(),
            category: briefing.category,
            ...(handoffId ? { handoffId } : {}),
            scheduled: callAt !== null,
            subject: briefing.subject,
          },
          kind: callAt
            ? AGENT_CALL_EVENT.ownerCallScheduled
            : AGENT_CALL_EVENT.ownerCallRequested,
        },
      );
      return created.id;
    });
  } catch (error) {
    // Two copies of one request (or two callbacks for one handoff) at once:
    // the first one won.
    if (!isUniqueViolation(error)) throw error;
    const winner =
      (await db.ownerCall.findUnique({
        select: { id: true },
        where: { idempotencyKey },
      }))
      ?? (handoffId
        ? await db.ownerCall.findUnique({
            select: { id: true },
            where: { fromHandoffId: handoffId },
          })
        : null);
    if (!winner) throw error;
    return {
      alreadyRequested: true,
      ownerCall: await summaryById(db, winner.id),
    };
  }

  if (!callAt) {
    await placeOwnerCall(principal, { now, ownerCallId }, db, ports, {
      throwOnFailure: true,
    });
  }
  return {
    alreadyRequested: false,
    ownerCall: await summaryById(db, ownerCallId),
  };
}

// ── Ringing ─────────────────────────────────────────────────────────────

async function settle(
  db: TransactionalDomainDb,
  ownerCallId: string,
  status: "FAILED" | "SCHEDULED",
  event: {
    readonly kind: (typeof AGENT_CALL_EVENT)[keyof typeof AGENT_CALL_EVENT];
    readonly at: Date;
    readonly reason: string;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.ownerCall.update({
      data:
        status === "FAILED"
          ? { failureReason: event.reason, status: OwnerCallStatus.FAILED }
          : { status: OwnerCallStatus.SCHEDULED },
      where: { id: ownerCallId },
    });
    await recordAgentCallEvent(
      tx,
      { ownerCallId },
      { at: event.at, detail: { reason: event.reason }, kind: event.kind },
    );
    if (status === "FAILED") {
      await reopenHandoffForFailedCallback(tx, {
        now: event.at,
        ownerCallId,
        reason: event.reason,
      });
    }
  });
}

/**
 * Ring one SCHEDULED owner call now. The timer's and an immediate request's
 * shared path. The SCHEDULED → PLACING claim is the lock: whoever loses it
 * does nothing.
 *
 * Held up by Mili being busy or the hourly cap, a call goes back to
 * SCHEDULED for the next run — until it is OWNER_CALL_LIMITS.missedAfterMinutes
 * late, when it is dropped as missed. Any other refusal fails it, and so does
 * a carrier error; an ambiguous carrier answer is never retried.
 */
export async function placeOwnerCall(
  principal: DomainPrincipal,
  input: { readonly ownerCallId: string; readonly now?: Date },
  db: TransactionalDomainDb,
  ports: Ports = {},
  options: { readonly throwOnFailure?: boolean } = {},
): Promise<PlaceOwnerCallOutcome> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const { ownerCallId } = input;
  const claimed = await db.ownerCall.updateMany({
    data: { status: OwnerCallStatus.PLACING },
    where: { id: ownerCallId, status: OwnerCallStatus.SCHEDULED },
  });
  if (claimed.count === 0) return "skipped";
  const request = await db.ownerCall.findUnique({
    select: { callAt: true, category: true },
    where: { id: ownerCallId },
  });
  if (!request) return "skipped";

  const fail = async (reason: string, error?: unknown) => {
    await settle(db, ownerCallId, "FAILED", {
      at: new Date(),
      kind: AGENT_CALL_EVENT.ownerCallFailed,
      reason,
    });
    if (options.throwOnFailure) {
      throw error ?? new DomainTransitionError(reason);
    }
    return "failed" as const;
  };

  const line = await readOwnerLine(db);
  if (!line) return fail(OWNER_CALL_REFUSALS.noLine);
  // The business numbers may have changed since the line was saved.
  if (isBusinessNumber(line.e164, ports.channel?.numbers ?? [])) {
    return fail(OWNER_CALL_REFUSALS.businessNumber);
  }

  // Too late to be worth ringing, whatever held it up (Mili busy, a timer
  // that was lost and re-armed by the hourly backstop).
  const lateMs = now.getTime() - request.callAt.getTime();
  if (lateMs > OWNER_CALL_LIMITS.missedAfterMinutes * 60 * 1000) {
    return fail(OWNER_CALL_REFUSALS.missed);
  }

  const holdUp = async (blocker: string) => {
    if (options.throwOnFailure) return fail(blocker);
    await settle(db, ownerCallId, "SCHEDULED", {
      at: now,
      kind: AGENT_CALL_EVENT.ownerCallDeferred,
      reason: blocker,
    });
    return "deferred" as const;
  };

  // A first look that writes nothing; the check that holds is in `prepare`.
  const blocker = await ownerCallBlocker(db, now);
  if (blocker) return holdUp(blocker);

  try {
    const placed = await placeStaffCall(
      principal,
      {
        history: async () => {
          // No lead or project to log it on: the OwnerCall and its events
          // are the record, read by the admin page and get_owner_call.
        },
        kind: OutboxEventKind.OWNER_CALL_PLACE,
        link: { contactName: line.nickname },
        now,
        outboxKey: ownerCallOutboxKey(ownerCallId),
        payload: {
          category: request.category,
          ownerCallId,
          requestedBy: describePrincipal(principal),
        },
        phoneId: null,
        prepare: async (tx, callId) => {
          // The limits again, behind one lock and in the transaction that
          // reserves this call row: two calls due in the same minute cannot
          // both find Mili free. Committed (lock released) before the
          // carrier is asked.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PLACE_LOCK_KEY}, 0))`;
          const held = await ownerCallBlocker(tx, now, callId);
          if (held) throw new OwnerCallHeldError(held);
          // Before the phone rings: Mili's session finds the briefing by it.
          await tx.ownerCall.update({
            data: { callId },
            where: { id: ownerCallId },
          });
        },
        resolveTo: () => line.e164,
        target: "agent",
      },
      db,
      ports,
    );
    await db.$transaction(async (tx) => {
      await tx.ownerCall.update({
        data: { placedAt: now, status: OwnerCallStatus.PLACED },
        where: { id: ownerCallId },
      });
      await recordAgentCallEvent(
        tx,
        { callId: placed.call.id, ownerCallId },
        {
          at: new Date(),
          detail: { callId: placed.call.id, to: maskNumber(line.e164) },
          kind: AGENT_CALL_EVENT.ownerCallPlaced,
        },
      );
    });
    return "placed";
  } catch (error) {
    if (error instanceof OwnerCallHeldError) return holdUp(error.message);
    if (!isDomainError(error)) {
      // Unexpected: the claim stays PLACING, so nothing re-rings it blindly.
      // The hourly backstop settles it (recoverStalePlacingOwnerCalls).
      throw error;
    }
    return fail(error.message, error);
  }
}

/**
 * Settle claims left PLACING by a placement that stopped part way (a
 * database failure, a function cut off). The call row is linked in the
 * transaction that reserves it, before the carrier is asked, so:
 *
 *   no call linked           nothing was committed and nothing rang: back to
 *                            SCHEDULED, for its timer to ring it or drop it
 *                            as missed
 *   the carrier gave an id   it rang: PLACED
 *   the call row failed      FAILED, with the carrier's reason
 *   anything else            it may have rung: FAILED as uncertain, and
 *                            never rung again
 *
 * Returns the ids sent back to SCHEDULED, for their timers to be armed.
 */
export async function recoverStalePlacingOwnerCalls(
  principal: DomainPrincipal,
  input: { readonly now?: Date },
  db: TransactionalDomainDb,
): Promise<readonly string[]> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const stale = await db.ownerCall.findMany({
    orderBy: { updatedAt: "asc" },
    select: {
      call: {
        select: {
          id: true,
          providerCallId: true,
          providerErrorTitle: true,
          startedAt: true,
          status: true,
        },
      },
      id: true,
      updatedAt: true,
    },
    take: 50,
    where: {
      status: OwnerCallStatus.PLACING,
      updatedAt: { lt: new Date(now.getTime() - STALE_PLACING_MS) },
    },
  });
  const rearm: string[] = [];
  for (const row of stale) {
    const call = row.call;
    // Only the same stale claim: a placement that moved on since is left be.
    const where = {
      id: row.id,
      status: OwnerCallStatus.PLACING,
      updatedAt: row.updatedAt,
    };
    let outcome: {
      readonly data: Prisma.OwnerCallUpdateManyMutationInput;
      readonly kind: (typeof AGENT_CALL_EVENT)[keyof typeof AGENT_CALL_EVENT];
      readonly detail: Record<string, unknown>;
    };
    if (!call) {
      outcome = {
        data: { status: OwnerCallStatus.SCHEDULED },
        detail: { reason: "Placing was interrupted before it rang." },
        kind: AGENT_CALL_EVENT.ownerCallDeferred,
      };
    } else if (call.providerCallId && call.status !== CallStatus.FAILED) {
      outcome = {
        data: { placedAt: call.startedAt, status: OwnerCallStatus.PLACED },
        detail: { callId: call.id, recovered: true },
        kind: AGENT_CALL_EVENT.ownerCallPlaced,
      };
    } else {
      const reason =
        call.status === CallStatus.FAILED
          ? (call.providerErrorTitle ?? "The carrier refused the call.")
          : OWNER_CALL_REFUSALS.uncertain;
      outcome = {
        data: { failureReason: reason, status: OwnerCallStatus.FAILED },
        detail: { reason },
        kind: AGENT_CALL_EVENT.ownerCallFailed,
      };
    }
    const settled = await db.$transaction(async (tx) => {
      const moved = await tx.ownerCall.updateMany({
        data: outcome.data,
        where,
      });
      if (moved.count === 0) return false;
      await recordAgentCallEvent(
        tx,
        { callId: call?.id, ownerCallId: row.id },
        { at: now, detail: outcome.detail, kind: outcome.kind },
      );
      if (outcome.kind === AGENT_CALL_EVENT.ownerCallFailed) {
        await reopenHandoffForFailedCallback(tx, {
          now,
          ownerCallId: row.id,
          reason: String(outcome.detail.reason ?? "it didn't ring"),
        });
      }
      return true;
    });
    if (settled && !call) rearm.push(row.id);
  }
  return rearm;
}

/**
 * Scheduled owner calls that need a timer (lib/workflow/owner-call.ts): the
 * ones named, or every one due before `dueBefore` (overdue included, which
 * the timer then rings or drops as missed). Arming one twice is harmless.
 */
export async function ownerCallsToArm(
  principal: DomainPrincipal,
  input: {
    readonly ownerCallIds?: readonly string[];
    readonly dueBefore?: Date;
  },
  db: DomainDb,
): Promise<readonly { readonly id: string; readonly callAt: Date }[]> {
  requireAdminPrincipal(principal);
  if (!input.ownerCallIds && !input.dueBefore) return [];
  if (input.ownerCallIds && input.ownerCallIds.length === 0) return [];
  return db.ownerCall.findMany({
    orderBy: { callAt: "asc" },
    select: { callAt: true, id: true },
    take: 200,
    where: {
      status: OwnerCallStatus.SCHEDULED,
      ...(input.ownerCallIds ? { id: { in: [...input.ownerCallIds] } } : {}),
      ...(input.dueBefore ? { callAt: { lte: input.dueBefore } } : {}),
    },
  });
}

/** Cancel a call that has not rung yet. ADMIN or Hermes. */
export async function cancelOwnerCall(
  principal: DomainPrincipal,
  input: { readonly ownerCallId: string; readonly now?: Date },
  db: TransactionalDomainDb,
): Promise<OwnerCallSummary> {
  requireAdminPrincipal(principal);
  const now = input.now ?? new Date();
  const by =
    principal.kind === "system"
      ? principal.reason
      : describePrincipal(principal);
  const canceled = await db.$transaction(async (tx) => {
    const updated = await tx.ownerCall.updateMany({
      data: {
        canceledAt: now,
        canceledBy: by,
        status: OwnerCallStatus.CANCELED,
      },
      where: { id: input.ownerCallId, status: OwnerCallStatus.SCHEDULED },
    });
    if (updated.count === 0) return false;
    await recordAgentCallEvent(
      tx,
      { ownerCallId: input.ownerCallId },
      { at: now, detail: { by }, kind: AGENT_CALL_EVENT.ownerCallCanceled },
    );
    return true;
  });
  const summary = await summaryById(db, input.ownerCallId);
  if (!canceled && summary.status !== OwnerCallStatus.CANCELED) {
    throw new DomainTransitionError(OWNER_CALL_REFUSALS.notScheduled);
  }
  return summary;
}

// ── On the call ─────────────────────────────────────────────────────────

/**
 * The briefing for the call a stream token names, or null when it is not an
 * owner call. The token's carrier call id must match the row, as for any
 * caller (callers/resolve.ts), so one call's token never opens another's.
 */
export async function readOwnerCallForVoice(
  authority: VoiceCallAuthority,
  db: DomainDb,
): Promise<OwnerCallVoiceBriefing | null> {
  const call = await db.call.findUnique({
    select: {
      contactName: true,
      direction: true,
      ownerCall: {
        select: {
          agenda: true,
          category: true,
          context: true,
          eventAt: true,
          reference: true,
          subject: true,
        },
      },
      providerCallId: true,
      staffTarget: true,
    },
    where: { id: authority.callId },
  });
  if (
    !call?.ownerCall
    || call.direction !== CommsDirection.OUTBOUND
    || call.staffTarget !== CallStaffTarget.AGENT
    || call.providerCallId !== authority.providerCallId
  ) {
    return null;
  }
  const b = call.ownerCall;
  return {
    agenda: b.agenda,
    callId: authority.callId,
    category: isOwnerCallCategory(b.category) ? b.category : "other",
    context: b.context,
    eventAt: b.eventAt,
    ownerName: call.contactName ?? "there",
    reference: b.reference,
    subject: b.subject,
  };
}

/** What Hermes is told the call is about, with every question. */
function assistantContext(briefing: OwnerCallVoiceBriefing): string {
  return [
    `Mili (Royal Constructions' voice assistant) is on a phone call with ${briefing.ownerName}, briefing them on: ${briefing.subject}.`,
    `Category: ${briefing.category}.`,
    ...(briefing.reference ? [`Your reference: ${briefing.reference}.`] : []),
    ...(briefing.agenda.length
      ? ["Agenda:", ...briefing.agenda.map((item) => `- ${item}`)]
      : []),
    "Answer in two or three short sentences of plain text that can be read aloud. No markdown, links or lists.",
  ].join("\n");
}

/**
 * Pass the owner's question to Hermes and return what Mili may read out.
 *
 * Throws when this is not a live owner call, Hermes is not connected, the
 * call has used its questions, or Hermes fails or answers nothing. Mili is
 * then told she could not check — never that there is no answer.
 */
export async function askOwnerAssistant(
  authority: VoiceCallAuthority,
  input: { readonly question: string },
  db: DomainDb,
  ports: { readonly assistant?: OwnerAssistantPort | null },
): Promise<string> {
  const question = oneLine(input.question).slice(
    0,
    ASK_HERMES_QUESTION_MAX_CHARS,
  );
  if (!question) {
    throw new DomainValidationError("There is no question to ask.", "question");
  }
  const assistant = ports.assistant ?? null;
  if (!assistant) {
    throw new DomainSideEffectError(
      "Hermes isn't connected in this runtime.",
      "owner-assistant",
      false,
    );
  }
  const briefing = await readOwnerCallForVoice(authority, db);
  if (!briefing) {
    throw new DomainNotFoundError("This is not an owner call.");
  }
  // Counted before asking, so a failed question still uses one: a desk that
  // keeps asking a question Hermes cannot answer is stopped all the same.
  const counted = await db.ownerCall.updateMany({
    data: { questionsAsked: { increment: 1 } },
    where: {
      callId: authority.callId,
      questionsAsked: { lt: ASK_HERMES_MAX_PER_CALL },
    },
  });
  if (counted.count === 0) {
    throw new DomainTransitionError(
      "This call has already passed Hermes as many questions as it may.",
    );
  }
  let answer: string;
  try {
    answer = await assistant.ask({
      callId: authority.callId,
      context: assistantContext(briefing),
      question,
      reference: briefing.reference,
    });
  } catch (error) {
    throw new DomainSideEffectError(
      "Hermes didn't answer.",
      "owner-assistant",
      true,
      { cause: error },
    );
  }
  const spoken = answer.replace(/\s+/g, " ").trim();
  if (!spoken) {
    throw new DomainSideEffectError(
      "Hermes answered with nothing.",
      "owner-assistant",
      true,
    );
  }
  return spoken.length <= ASK_HERMES_ANSWER_MAX_CHARS
    ? spoken
    : `${spoken.slice(0, ASK_HERMES_ANSWER_MAX_CHARS - 2).trimEnd()} …`;
}
