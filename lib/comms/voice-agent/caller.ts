import {
  voiceAgentGreetingCue,
  voiceAgentInstructions,
} from "@/lib/domain/comms/calls/voice-agent";
import { openVoiceCallerAccess } from "@/lib/domain/comms/callers/access";
import { voiceCallAuthority } from "@/lib/domain/comms/callers/identity";
import { runVoiceLookup } from "@/lib/domain/comms/callers/lookups";
import type { DomainDb } from "@/lib/domain/db";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import { reportError } from "@/lib/observability/report-error";

import type { VoiceCallerSetup } from "./session";
import type { StreamTokenClaims } from "./token";

// Who is on the line, for Mili: the adapter between her session and the
// domain's caller rules (lib/domain/comms/callers).
//
// It only wires: the stream token the session verified becomes the call's
// authority, the domain resolves the caller and builds their briefing and
// lookups, and this hands the session the instructions to start her with and
// a function that runs a lookup as that caller. It decides nothing.
//
// A failure is reported (an outage here would otherwise be noticed only as
// "Mili stopped knowing who anyone is") and rethrown; the session then starts
// her for an unknown caller.

export type VoiceCallerDeps = {
  readonly db: DomainDb;
  /** COMMS_AGENT_DISCLOSURE_ENABLED. Off: every caller is unknown. */
  readonly disclosure: boolean;
  /** The context index's embeddings, for finding the record a caller means. */
  readonly embedding?: EmbeddingPort;
  readonly now?: () => Date;
};

export function voiceCallerPreparer(
  deps: VoiceCallerDeps,
): (claims: StreamTokenClaims) => Promise<VoiceCallerSetup> {
  const now = deps.now ?? (() => new Date());
  return async (claims) => {
    try {
      const access = await openVoiceCallerAccess(
        voiceCallAuthority(claims),
        { enabled: deps.disclosure, now: now() },
        deps.db,
      );
      return {
        callerClass: access.context?.callerClass ?? "unknown",
        greetingCue: voiceAgentGreetingCue(access.context),
        instructions: voiceAgentInstructions(access.context),
        lookup: access.lookups.length
          ? async (request) => {
              try {
                const result = await runVoiceLookup(
                  access.caller,
                  request,
                  deps.db,
                  { now: now() },
                  { embedding: deps.embedding },
                );
                return result.text;
              } catch (error) {
                reportError(error, {
                  ids: { callId: claims.callId },
                  source: `voice-agent:lookup:${request.name}`,
                });
                throw error;
              }
            }
          : null,
        lookups: access.lookups,
      };
    } catch (error) {
      reportError(error, {
        ids: { callId: claims.callId },
        source: "voice-agent:resolve-caller",
      });
      throw error;
    }
  };
}
