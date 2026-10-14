import { TradieScheduleStatus } from "@prisma/client";

// Which status a booking may move to from the one it is in.
//
// This used to be written twice — once in `schedules.ts` for the command and
// once in `types/tradie.ts` for the status modal — and the two disagreed about
// AWAITING_QUOTE. The modal offered "Availability confirmed" and "Declined";
// the command only allowed PENDING_RESPONSE and NO_RESPONSE, so every button
// the office could press on a quote booking came back 409. The tradie-reply
// webhook was refused the same way: `tradieReplyStatus` maps a yes to
// AWAITING_ADMIN_APPROVAL and a no to DECLINED, so an emailed quote never moved
// the booking either. AWAITING_QUOTE now carries both sets of edges.
//
// Pure, so the modal can hide what the command would refuse, from the same
// table the command applies.

export const SCHEDULE_TRANSITIONS: Readonly<
  Record<TradieScheduleStatus, readonly TradieScheduleStatus[]>
> = {
  [TradieScheduleStatus.PENDING]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.NO_RESPONSE,
    TradieScheduleStatus.PENDING_RESPONSE,
  ],
  [TradieScheduleStatus.AWAITING_QUOTE]: [
    TradieScheduleStatus.QUOTE_RECEIVED,
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
    TradieScheduleStatus.PENDING_RESPONSE,
    TradieScheduleStatus.NO_RESPONSE,
  ],
  [TradieScheduleStatus.PENDING_RESPONSE]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.QUOTE_RECEIVED]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.AWAITING_ADMIN_APPROVAL]: [
    TradieScheduleStatus.CONFIRMED,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.CONFIRMED]: [
    TradieScheduleStatus.COMPLETED,
    TradieScheduleStatus.DECLINED,
    // Admin approval updates the row in its transaction and then runs the
    // normal side-effect path with the same final status.
    TradieScheduleStatus.CONFIRMED,
  ],
  [TradieScheduleStatus.PENDING_FINAL_CONFIRMATION]: [
    TradieScheduleStatus.CONFIRMED,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.NO_RESPONSE]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.DECLINED]: [
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    TradieScheduleStatus.PENDING_RESPONSE,
    TradieScheduleStatus.NO_RESPONSE,
    // Admin rejection updates the row first, then runs the shared status
    // side-effect path with DECLINED again.
    TradieScheduleStatus.DECLINED,
  ],
  [TradieScheduleStatus.COMPLETED]: [],
  [TradieScheduleStatus.CANCELLED]: [],
};

export function canTransitionSchedule(
  from: TradieScheduleStatus,
  to: TradieScheduleStatus,
): boolean {
  return SCHEDULE_TRANSITIONS[from].includes(to);
}
