import type { VoiceCallerContext } from "../calls/voice-agent";
import type { DomainDb } from "../../db";
import { briefVoiceCaller } from "./briefing";
import type { VoiceCallAuthority, VoiceCallerPrincipal } from "./identity";
import { voiceLookupsFor, type VoiceLookupDefinition } from "./lookups";
import { resolveVoiceCaller } from "./resolve";

// Everything Mili is given about one caller, decided once when her session
// opens: who they are, the briefing she may answer from, and the lookups the
// call desk may run for them. The voice adapter starts her with exactly this
// and nothing else, so a call never inherits another call's briefing or tools.

export type VoiceCallerAccess = {
  readonly caller: VoiceCallerPrincipal;
  /** Null: message taking only. */
  readonly context: VoiceCallerContext | null;
  /** The desk's lookup tools for this caller. Empty unless an admin. */
  readonly lookups: readonly VoiceLookupDefinition[];
};

/**
 * Resolve the caller and build what Mili may use.
 *
 * Throws when the database does or the caller's relationship no longer holds;
 * the adapter then starts her for an unknown caller. Never returns more access
 * than the resolved class allows, and never falls back to a wider one.
 */
export async function openVoiceCallerAccess(
  authority: VoiceCallAuthority,
  input: { readonly enabled: boolean; readonly now: Date },
  db: DomainDb,
): Promise<VoiceCallerAccess> {
  const caller = await resolveVoiceCaller(
    authority,
    { enabled: input.enabled },
    db,
  );
  const briefing = await briefVoiceCaller(caller, { now: input.now }, db);
  if (!briefing) return { caller, context: null, lookups: [] };
  const lookups = voiceLookupsFor(caller);
  return {
    caller,
    context: {
      briefing: briefing.text,
      callerClass: briefing.callerClass,
      canLookUp: lookups.length > 0,
      firstName: briefing.firstName,
    },
    lookups,
  };
}
