import { Prisma } from "@prisma/client";

import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { DomainPrincipal } from "../../principal";

// The log of an agent call: what happened, in order, kept for the office.
//
// Two sources write to it. The owner-call commands (owner-call.ts) record a
// request's lifecycle — asked for, scheduled, placed, failed, cancelled — in
// the transaction that changes it. Mili's session records what the call desk
// did on the call — every lookup and question to Hermes with its answer and
// how long it took, ending the call, how the session ended — through an
// asynchronous writer (lib/comms/voice-agent/event-writer.ts), because what
// Mili says next must never wait on a database write.
//
// What was said is the transcript's job; this is what was *done*. Details are
// bounded so one runaway answer cannot bloat a row.

export const AGENT_CALL_EVENT = {
  ownerCallRequested: "owner_call.requested",
  ownerCallScheduled: "owner_call.scheduled",
  ownerCallPlaced: "owner_call.placed",
  ownerCallDeferred: "owner_call.deferred",
  ownerCallFailed: "owner_call.failed",
  ownerCallCanceled: "owner_call.canceled",
  sessionStarted: "session.started",
  deskLookup: "desk.lookup",
  deskEndCall: "desk.end_call",
  deskTransfer: "desk.transfer",
  deskFailed: "desk.failed",
  sessionEnded: "session.ended",
  // What the call left for Hermes (owner-call-handoff.ts).
  handoffNoted: "handoff.noted",
  handoffReady: "handoff.ready",
  handoffDelivered: "handoff.delivered",
  handoffFailed: "handoff.failed",
  handoffResolved: "handoff.resolved",
  handoffReopened: "handoff.reopened",
  // A callback Hermes scheduled for a handoff did not reach the owner.
  handoffCallbackMissed: "handoff.callback_missed",
} as const;

export type AgentCallEventKind =
  (typeof AGENT_CALL_EVENT)[keyof typeof AGENT_CALL_EVENT];

export type AgentCallEventInput = {
  readonly kind: AgentCallEventKind;
  readonly at: Date;
  readonly detail?: Record<string, unknown> | null;
};

export type AgentCallEventRecord = {
  readonly id: string;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly detail: Record<string, unknown> | null;
};

/** One string field in a detail, at most. */
const DETAIL_TEXT_MAX_CHARS = 4_000;
/** Events one session write may carry. */
const MAX_EVENTS_PER_WRITE = 100;

function boundedDetail(
  detail: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!detail) return Prisma.DbNull;
  const bounded = JSON.parse(
    JSON.stringify(detail, (_key, value: unknown) =>
      typeof value === "string" && value.length > DETAIL_TEXT_MAX_CHARS
        ? `${value.slice(0, DETAIL_TEXT_MAX_CHARS - 2)} …`
        : value,
    ),
  ) as Prisma.InputJsonValue;
  return bounded;
}

/** Record one event in the caller's transaction. */
export async function recordAgentCallEvent(
  db: DomainDb,
  target: {
    readonly ownerCallId?: string | null;
    readonly callId?: string | null;
  },
  event: AgentCallEventInput,
): Promise<void> {
  await db.agentCallEvent.create({
    data: {
      callId: target.callId ?? null,
      detail: boundedDetail(event.detail),
      kind: event.kind,
      occurredAt: event.at,
      ownerCallId: target.ownerCallId ?? null,
    },
  });
}

/**
 * Keep what the call desk did on one call. The session's writer only: a
 * verified carrier stream's own call (the token named it, and the carrier's
 * call id must still match the row), never another call's log.
 *
 * Returns how many were kept; zero when the call is not this one.
 */
export async function recordVoiceAgentEvents(
  principal: DomainPrincipal,
  input: {
    readonly callId: string;
    readonly providerCallId: string;
    readonly events: readonly AgentCallEventInput[];
  },
  db: DomainDb,
): Promise<number> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only Mili's own session may record what happened on her call.",
    );
  }
  if (input.events.length === 0) return 0;
  const call = await db.call.findUnique({
    select: {
      id: true,
      ownerCall: { select: { id: true } },
      providerCallId: true,
    },
    where: { id: input.callId },
  });
  if (!call || call.providerCallId !== input.providerCallId) return 0;
  const events = input.events.slice(0, MAX_EVENTS_PER_WRITE);
  await db.agentCallEvent.createMany({
    data: events.map((event) => ({
      callId: call.id,
      detail: boundedDetail(event.detail),
      kind: event.kind,
      occurredAt: event.at,
      ownerCallId: call.ownerCall?.id ?? null,
    })),
  });
  return events.length;
}

export function toAgentCallEventRecord(row: {
  id: string;
  kind: string;
  occurredAt: Date;
  detail: Prisma.JsonValue;
}): AgentCallEventRecord {
  const detail =
    row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : null;
  return { detail, id: row.id, kind: row.kind, occurredAt: row.occurredAt };
}
