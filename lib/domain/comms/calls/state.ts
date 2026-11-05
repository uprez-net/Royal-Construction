import { CallStatus } from "@prisma/client";

import type { CallState } from "../../ports/comms";

// The call state machine (file 01 §8, file 06 §6.3).
//
//   QUEUED 0 < INITIATED 1 < RINGING 2 < IN_PROGRESS 3 < terminal 4
//
// A call only moves forward. A terminal call never reopens; a later event may
// only fill in a duration that was missing. Every adapter maps into this one
// vocabulary — there is no second one per vendor.

const FROM_STATE: Record<CallState, CallStatus> = {
  busy: CallStatus.BUSY,
  canceled: CallStatus.CANCELED,
  completed: CallStatus.COMPLETED,
  failed: CallStatus.FAILED,
  "in-progress": CallStatus.IN_PROGRESS,
  initiated: CallStatus.INITIATED,
  "no-answer": CallStatus.NO_ANSWER,
  queued: CallStatus.QUEUED,
  ringing: CallStatus.RINGING,
};

const RANK: Record<CallStatus, number> = {
  [CallStatus.QUEUED]: 0,
  [CallStatus.INITIATED]: 1,
  [CallStatus.RINGING]: 2,
  [CallStatus.IN_PROGRESS]: 3,
  [CallStatus.COMPLETED]: 4,
  [CallStatus.BUSY]: 4,
  [CallStatus.NO_ANSWER]: 4,
  [CallStatus.FAILED]: 4,
  [CallStatus.CANCELED]: 4,
};

export function callStatusOf(state: CallState): CallStatus {
  return FROM_STATE[state];
}

export function isTerminalCallStatus(status: CallStatus): boolean {
  return RANK[status] === 4;
}

/** True when `next` may replace `current`. */
export function callStatusAdvances(current: CallStatus, next: CallStatus): boolean {
  return RANK[next] > RANK[current];
}

/** Calls still live after this long are asked about (the whole-call ceiling). */
export const CALL_TIME_LIMIT_SECONDS = 4 * 60 * 60;

/** A call that has not been answered in this long has stopped ringing. */
export const RINGING_STALE_MS = 10 * 60 * 1000;
