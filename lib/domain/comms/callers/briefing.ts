import type { DomainDb } from "../../db";
import { recordCallerAccess } from "./audit";
import { adminBriefing } from "./briefing-admin";
import { clientBriefing } from "./briefing-client";
import { siteManagerBriefing } from "./briefing-site-manager";
import { tradieBriefing } from "./briefing-tradie";
import type { VoiceCallerClass, VoiceCallerPrincipal } from "./identity";

// What Mili knows about a verified caller before they say a word.
//
// One bounded, role-scoped briefing per call, read and allowlisted here and
// handed to her when her session starts — deterministic, so it does not
// depend on GPT-Live choosing to ask for anything. Each builder selects only
// the fields that class may hear: there is no full record followed by a
// prompt asking her to leave parts out.
//
//   CLIENT        briefing-client.ts
//   TRADIE        briefing-tradie.ts
//   SITE_MANAGER  briefing-site-manager.ts
//   ADMIN         briefing-admin.ts
//
// Each role's file says what that class may hear, so one class's policy can
// change without touching another's. The shared stage wording and length cap
// are in briefing-lines.ts.
//
// The relationship is re-read first (relationships.ts) and the briefing is
// audited before it is returned.

export type VoiceBriefing = {
  readonly callerClass: Exclude<VoiceCallerClass, "unknown">;
  readonly firstName: string | null;
  /** The facts Mili may say, one per line. */
  readonly text: string;
  readonly recordIds: readonly string[];
};

/**
 * The briefing for this caller, or null for an unknown one (who gets none).
 *
 * Throws when the relationship no longer holds or the database fails; the
 * adapter then starts Mili as for an unknown caller. Audited before it is
 * returned, so nothing reaches her that the trail does not show.
 */
export async function briefVoiceCaller(
  caller: VoiceCallerPrincipal,
  input: { readonly now: Date },
  db: DomainDb,
): Promise<VoiceBriefing | null> {
  const identity = caller.identity;
  if (identity.class === "unknown") return null;
  const built =
    identity.class === "client"
      ? await clientBriefing(caller, db, input.now)
      : identity.class === "tradie"
        ? await tradieBriefing(caller, db, input.now)
        : identity.class === "site_manager"
          ? await siteManagerBriefing(caller, db, input.now)
          : await adminBriefing(caller, db, input.now);
  await recordCallerAccess(
    caller,
    { kind: "BRIEFING", outcome: "ok", recordIds: built.recordIds },
    db,
  );
  return {
    ...built,
    callerClass: identity.class,
    firstName: identity.firstName,
  };
}
