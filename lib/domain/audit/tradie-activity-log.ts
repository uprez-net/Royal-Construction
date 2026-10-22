import {
  createTradieActivityLogEntry,
  type TradieActivityLogDataMap,
  type TradieActivityLogType,
} from "@/types/tradieActivityLog";

import type { DomainDb } from "../db";
import { attributionUserId, type DomainPrincipal } from "../principal";

// The tradie's activity log: one writer, called by the domain commands that
// change a tradie's bookings, so a change made from the screen, by Eve, by the
// email-reply webhook or by a cron is recorded the same way.
//
// Two doors, because where the call sits decides what a failure means:
//
//   - `recordTradieActivity`, inside a transaction. A database error is
//     thrown. Swallowing it would leave Postgres holding an aborted
//     transaction that rolls back on commit, while the command reported
//     success — the silent failure this repo works hardest to avoid. A
//     failed audit write fails the operation, and nothing is half-written.
//   - `noteTradieActivity`, after something outside the database has already
//     happened — an email sent, a cron run. Never throws: a log write must not
//     turn a sent email into an error the office retries.
//
// A payload that fails its schema is a programming error, not the operator's,
// and is never allowed to stop the operation it describes. It is logged to
// the console and skipped by both.

type Write<T extends TradieActivityLogType> = {
  readonly type: T;
  readonly data: TradieActivityLogDataMap[T];
  /** Who did it; null for a cron with no principal. */
  readonly principal: DomainPrincipal | null;
};

function render<T extends TradieActivityLogType>(write: Write<T>) {
  try {
    return createTradieActivityLogEntry(write.type, write.data);
  } catch (error) {
    console.error(
      `[audit] Tradie activity "${write.type}" did not match its schema; not recorded`,
      error,
    );
    return null;
  }
}

async function insert<T extends TradieActivityLogType>(
  write: Write<T>,
  db: DomainDb,
): Promise<void> {
  const entry = render(write);
  if (!entry) return;
  await db.tradieActivityLog.create({
    data: {
      authorId: write.principal ? attributionUserId(write.principal) : null,
      createdAt: new Date(entry.timestamp),
      id: entry.id,
      message: entry.message,
      milestoneId: entry.milestoneId ?? null,
      projectId: entry.projectId ?? null,
      scheduleId: entry.scheduleId ?? null,
      tradieId: entry.tradieId,
      type: entry.type,
    },
  });
}

/** Inside a transaction: the entry commits, or fails, with the change. */
export async function recordTradieActivity<T extends TradieActivityLogType>(
  write: Write<T>,
  db: DomainDb,
): Promise<void> {
  await insert(write, db);
}

/** After an outside effect: recorded if it can be, never thrown. */
export async function noteTradieActivity<T extends TradieActivityLogType>(
  write: Write<T>,
  db: DomainDb,
): Promise<void> {
  try {
    await insert(write, db);
  } catch (error) {
    console.error("[audit] Failed to write the tradie activity log", error);
  }
}

/** The `via` for a principal: a system principal's reason, else nothing. */
export function viaOf(principal: DomainPrincipal | null): string | null {
  return principal?.kind === "system" ? principal.reason : null;
}
