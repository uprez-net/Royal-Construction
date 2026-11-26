import {
  voiceAgentGreetingCue,
  voiceAgentInstructions,
} from "@/lib/domain/comms/calls/voice-agent";
import {
  askOwnerAssistant,
  readOwnerCallForVoice,
} from "@/lib/domain/comms/calls/owner-call";
import {
  ASK_HERMES_DEFINITION,
  OWNER_CALL_SILENCE_FOLLOW_UP_CUE,
  OWNER_CALL_SILENCE_GOODBYE_CUE,
  OWNER_CALL_WRAP_UP_CUE,
  ownerCallGreetingCue,
  voiceAgentOwnerCallInstructions,
  type OwnerCallVoiceBriefing,
} from "@/lib/domain/comms/calls/voice-agent-owner-call";
import {
  openVoiceCallerAccess,
  type VoiceCallerAccess,
} from "@/lib/domain/comms/callers/access";
import {
  voiceCallAuthority,
  type VoiceCallAuthority,
} from "@/lib/domain/comms/callers/identity";
import {
  runVoiceLookup,
  type VoiceLookupRequest,
} from "@/lib/domain/comms/callers/lookups";
import type { DomainDb } from "@/lib/domain/db";
import { DomainSideEffectError } from "@/lib/domain/errors";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import type { OwnerAssistantPort } from "@/lib/domain/ports/owner-assistant";
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

/**
 * How long a briefing call waits for the owner's CRM access before Mili
 * starts with the briefing alone. Well inside the session's own budget for
 * the whole setup (PREPARE_TIMEOUT_MS), which would otherwise start her as
 * for an inbound stranger.
 */
const OWNER_ACCESS_TIMEOUT_MS = 2_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type VoiceCallerDeps = {
  readonly db: DomainDb;
  /** COMMS_AGENT_DISCLOSURE_ENABLED. Off: every caller is unknown. */
  readonly disclosure: boolean;
  /** The context index's embeddings, for finding the record a caller means. */
  readonly embedding?: EmbeddingPort;
  /**
   * Hermes, for a question the owner asks on a briefing call that the
   * briefing does not cover. Absent: Mili answers from the briefing only.
   */
  readonly assistant?: OwnerAssistantPort | null;
  readonly now?: () => Date;
};

export function voiceCallerPreparer(
  deps: VoiceCallerDeps,
): (claims: StreamTokenClaims) => Promise<VoiceCallerSetup> {
  const now = deps.now ?? (() => new Date());

  /** Runs one catalogue lookup as this caller, reporting a failure. */
  const catalogueLookup =
    (access: VoiceCallerAccess, callId: string) =>
    async (request: VoiceLookupRequest): Promise<string> => {
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
          ids: { callId },
          source: `voice-agent:lookup:${request.name}`,
        });
        throw error;
      }
    };

  /**
   * Mili's own briefing call to the owner. Royal's catalogue lookups come
   * along only when the owner line resolves to a verified admin, exactly as
   * for an inbound call; the briefing itself does not depend on it, so a
   * failed resolution still leaves her with the briefing.
   */
  const ownerCallSetup = async (
    briefing: OwnerCallVoiceBriefing,
    authority: VoiceCallAuthority,
  ): Promise<VoiceCallerSetup> => {
    let access: VoiceCallerAccess | null = null;
    try {
      access = await within(
        openVoiceCallerAccess(
          authority,
          { enabled: deps.disclosure, now: now() },
          deps.db,
        ),
        OWNER_ACCESS_TIMEOUT_MS,
      );
    } catch (error) {
      reportError(error, {
        ids: { callId: authority.callId },
        source: "voice-agent:resolve-owner",
      });
    }
    const assistant = deps.assistant ?? null;
    const canAskAssistant = assistant !== null;
    const catalogue = access?.lookups ?? [];
    const runCatalogue =
      access && catalogue.length
        ? catalogueLookup(access, authority.callId)
        : null;
    return {
      callerClass: "owner",
      cues: {
        silenceFollowUp: OWNER_CALL_SILENCE_FOLLOW_UP_CUE,
        silenceGoodbye: OWNER_CALL_SILENCE_GOODBYE_CUE,
        wrapUp: OWNER_CALL_WRAP_UP_CUE,
      },
      desk: { canAskAssistant, kind: "owner_call" },
      greetingCue: ownerCallGreetingCue(briefing),
      instructions: voiceAgentOwnerCallInstructions(briefing, {
        canAskAssistant,
        caller: access?.context ?? null,
      }),
      lookup:
        canAskAssistant || runCatalogue
          ? async (request) => {
              if (request.name === "ask_hermes") {
                try {
                  return await askOwnerAssistant(
                    authority,
                    { question: request.question },
                    deps.db,
                    { assistant },
                  );
                } catch (error) {
                  // Hermes's own failure was reported by its adapter
                  // (lib/hermes); anything else is reported here.
                  if (!(error instanceof DomainSideEffectError)) {
                    reportError(error, {
                      ids: { callId: authority.callId },
                      source: "voice-agent:ask-hermes",
                    });
                  }
                  throw error;
                }
              }
              if (!runCatalogue) throw new Error("No lookups on this call.");
              return runCatalogue(request);
            }
          : null,
      lookups: [
        ...catalogue,
        ...(canAskAssistant ? [ASK_HERMES_DEFINITION] : []),
      ],
    };
  };

  return async (claims) => {
    try {
      const authority = voiceCallAuthority(claims);
      const briefing = await readOwnerCallForVoice(authority, deps.db);
      if (briefing) return await ownerCallSetup(briefing, authority);
      const access = await openVoiceCallerAccess(
        authority,
        { enabled: deps.disclosure, now: now() },
        deps.db,
      );
      return {
        callerClass: access.context?.callerClass ?? "unknown",
        greetingCue: voiceAgentGreetingCue(access.context),
        instructions: voiceAgentInstructions(access.context),
        lookup: access.lookups.length
          ? catalogueLookup(access, claims.callId)
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
