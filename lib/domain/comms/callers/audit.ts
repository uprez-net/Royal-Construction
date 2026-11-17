import type { CallerAccessKind, VoiceCallerClass } from "@prisma/client";

import type { DomainDb } from "../../db";
import type { VoiceCallerPrincipal } from "./identity";

// The audit trail for what Mili was allowed to say on a call.
//
// Metadata only: the class, how the caller was identified, the query's name
// and the ids it read. What was said is on the call's transcript; what a read
// returned, and the caller's number, are never written here.
//
// A disclosure is recorded before it is handed to Mili, and a failed write
// throws: an answer nobody can account for afterwards is not given.

const CLASS_COLUMN = {
  admin: "ADMIN",
  client: "CLIENT",
  site_manager: "SITE_MANAGER",
  tradie: "TRADIE",
  unknown: "UNKNOWN",
} as const satisfies Record<
  VoiceCallerPrincipal["identity"]["class"],
  VoiceCallerClass
>;

/**
 * At most this many ids per row. A disclosure that read more is written as
 * several rows of the same entry, so no id it read goes unrecorded.
 */
export const MAX_RECORD_IDS = 60;

export async function recordCallerAccess(
  caller: VoiceCallerPrincipal,
  entry: {
    readonly kind: CallerAccessKind;
    readonly outcome: string;
    readonly queryName?: string | null;
    readonly recordIds?: readonly string[];
  },
  db: DomainDb,
): Promise<void> {
  const row = {
    callId: caller.callId,
    callerClass: CLASS_COLUMN[caller.identity.class],
    kind: entry.kind,
    outcome: entry.outcome.slice(0, 60),
    queryName: entry.queryName ?? null,
    verification: caller.verification,
  };
  const ids = [...new Set(entry.recordIds ?? [])];
  if (ids.length <= MAX_RECORD_IDS) {
    await db.callerAccessEvent.create({ data: { ...row, recordIds: ids } });
    return;
  }
  // One statement, so the entry is written whole or not at all.
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_RECORD_IDS) {
    parts.push(ids.slice(i, i + MAX_RECORD_IDS));
  }
  await db.callerAccessEvent.createMany({
    data: parts.map((recordIds) => ({ ...row, recordIds })),
  });
}
