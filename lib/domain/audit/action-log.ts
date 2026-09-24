import type { DomainDb } from "../db";

// The project activity log: one writer, used by routes, workflow code, crons
// and domain commands alike.
//
// Moved from lib/data/actionLog.ts, which opened with `import "server-only"`
// and so could not be called from Eve or a script at all — the reason an Eve
// mutation's history simply went unwritten rather than being written
// differently.

export type ActionLogEntry = {
  readonly id?: string;
  readonly type: string;
  readonly message: string;
  readonly timestamp: string | number | Date;
  readonly projectId: string;
  readonly milestoneId?: string | null;
  /**
   * Who did it, from `attributionUserId(principal)`. Optional because a cron,
   * a webhook and the booking route genuinely have nobody behind them.
   *
   * lib/data/actionLog.ts had this line commented out, so every row written
   * through it is unattributed even when an operator was signed in. It is
   * honoured here, but the existing adapter still passes nothing, so nothing
   * changes until a caller starts sending it.
   */
  readonly authorId?: string | null;
};

/**
 * Write an activity-log row.
 *
 * Deliberately non-throwing, and deliberately not silent: a failed log must
 * not roll back the operation the operator actually asked for, but with three
 * people and nobody watching logs, swallowing it entirely is how a missing
 * audit trail goes unnoticed for months. Pass a transaction client to make the
 * log and the operation atomic where that matters — then a failure is the
 * caller's to handle, so use `logActionOrThrow` there instead.
 */
export async function logAction(
  entry: ActionLogEntry,
  db: DomainDb,
): Promise<void> {
  try {
    await logActionOrThrow(entry, db);
  } catch (error) {
    console.error("[audit] Failed to write the activity log", error);
  }
}

/**
 * The same write, surfacing its failure.
 *
 * For a command whose audit is part of what it promised — where reporting
 * success without the history row would be reporting something that did not
 * happen. Phase 2's lead-task history is the live example: the task write and
 * its history entry have to land together.
 */
export async function logActionOrThrow(
  entry: ActionLogEntry,
  db: DomainDb,
): Promise<void> {
  await db.activityLog.create({
    data: {
      authorId: entry.authorId ?? null,
      createdAt: new Date(entry.timestamp),
      id: entry.id,
      message: entry.message,
      milestoneId: entry.milestoneId ?? null,
      projectId: entry.projectId,
      type: entry.type,
    },
  });
}
