import "server-only";

import prisma from "@/lib/prisma";
import { ActivityLogEntry } from "@/types/activityLog";
import { Prisma } from "@prisma/client";

import { logAction as logActionDomain } from "@/lib/domain/audit/action-log";

/**
 * Creates a new activity log entry.
 *
 * The write itself is lib/domain/audit/action-log.ts, which Eve, crons and
 * scripts can reach too — this module's `import "server-only"` is why an Eve
 * mutation's activity row simply went unwritten rather than being written
 * differently.
 *
 * Failures are still swallowed here, unchanged: logging must not interrupt the
 * operation the operator asked for. A caller that needs the log and the
 * operation to land together should use `logActionOrThrow` inside its own
 * transaction instead.
 *
 * @param input - The activity log entry to persist.
 * @param tx - Optional Prisma transaction client used to execute the insert
 * within an existing database transaction.
 */
export async function logAction(
  input: ActivityLogEntry,
  tx?: Prisma.TransactionClient,
) {
  // authorId is deliberately not passed: this wrapper has never attributed a
  // row, and quietly starting to would change what every existing caller
  // writes. Callers opt in as their phase migrates.
  await logActionDomain(
    {
      id: input.id,
      message: input.message,
      milestoneId: input.milestoneId ?? null,
      projectId: input.projectId,
      timestamp: input.timestamp,
      type: input.type,
    },
    tx ?? prisma,
  );
}
