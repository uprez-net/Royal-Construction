import {
  OWNER_CALL_SILENCE_POLICY,
  voiceAgentGreetingCue,
  voiceAgentInstructions,
} from "@/lib/domain/comms/calls/voice-agent";
import {
  askOwnerAssistant,
  readOwnerCallForVoice,
} from "@/lib/domain/comms/calls/owner-call";
import { noteOwnerCallRequest } from "@/lib/domain/comms/calls/owner-call-handoff";
import {
  ASK_HERMES,
  ASK_HERMES_DEFINITION,
  ASK_HERMES_HOLD_MS,
  HAND_TO_HERMES_DEFINITION,
  OWNER_CALL_HAND_FAILED_CUE,
  OWNER_CALL_HOLD_FAILED_CUE,
  OWNER_CALL_HOLD_LOST_CUE,
  OWNER_CALL_LOOKUP_FAILED_CUE,
  OWNER_CALL_SILENCE_FOLLOW_UP_CUE,
  OWNER_CALL_SILENCE_GOODBYE_CUE,
  OWNER_CALL_WRAP_UP_CUE,
  ownerCallGreetingCue,
  ownerCallHandedCue,
  ownerCallHermesAnswerCue,
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
import type { TransactionalDomainDb } from "@/lib/domain/db";
import { DomainSideEffectError } from "@/lib/domain/errors";
import type { EmbeddingPort } from "@/lib/domain/ports/embedding";
import type { OwnerAssistantPort } from "@/lib/domain/ports/owner-assistant";
import { reportError } from "@/lib/observability/report-error";

import type { VoiceCallerSetup, VoiceLookupReply } from "./session";
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
  /** Transactional: a request the owner makes is noted in one. */
  readonly db: TransactionalDomainDb;
  /** COMMS_AGENT_DISCLOSURE_ENABLED. Off: every caller is unknown. */
  readonly disclosure: boolean;
  /** The context index's embeddings, for finding the record a caller means. */
  readonly embedding?: EmbeddingPort;
  /**
   * Hermes, for a question the owner asks on a briefing call that the
   * briefing does not cover. Absent: Mili answers from the briefing only.
   */
  readonly assistant?: OwnerAssistantPort | null;
  /** The music an owner holds to (hold-music.ts). Absent: silence. */
  readonly holdMusic?: () => Promise<Uint8Array | null>;
  /**
   * A request noted after the call's handoff had already gone to Hermes
   * reopened it: start delivering it again. Absent: the hourly backstop does.
   */
  readonly onHandoffReopened?: (
    handoffIds: readonly string[],
  ) => Promise<unknown>;
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
    const assistant = deps.assistant ?? null;
    const canAskAssistant = assistant !== null;
    // Loaded alongside the owner's access, within the same short wait: music
    // that is missing or slow means silence on hold, never a slower start or
    // a lost briefing.
    const music =
      canAskAssistant && deps.holdMusic
        ? within(deps.holdMusic(), OWNER_ACCESS_TIMEOUT_MS).catch(
            // loadHoldMusic reports its own failure.
            () => null,
          )
        : Promise.resolve(null);
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
    const catalogue = access?.lookups ?? [];
    const runCatalogue =
      access && catalogue.length
        ? catalogueLookup(access, authority.callId)
        : null;
    const holdAudio = await music;

    /** Note a request for Hermes; null when it could not be written. */
    const note = async (request: {
      readonly request: string;
      readonly callBack: boolean;
      readonly timing: string | null;
      readonly source: "owner" | "hold_failed";
    }): Promise<string | null> => {
      try {
        const noted = await noteOwnerCallRequest(
          authority,
          { ...request, now: now() },
          deps.db,
        );
        if (noted.reopened && deps.onHandoffReopened) {
          // Off the call's path; the backstop starts it if this fails.
          void deps
            .onHandoffReopened([noted.handoffId])
            .catch((error: unknown) => {
              console.error(
                "[voice-agent] could not restart delivery of a reopened handoff; the hourly backstop will.",
                error instanceof Error ? error.message : error,
              );
            });
        }
        return noted.handoffId;
      } catch (error) {
        reportError(error, {
          ids: { callId: authority.callId },
          source: "voice-agent:hand-to-hermes",
        });
        return null;
      }
    };

    /**
     * The owner chose to hold for Hermes. Its answer, or — when Hermes fails
     * or is slower than ASK_HERMES_HOLD_MS — a call back noted in its place,
     * so a question they waited on is never simply dropped.
     */
    const askWhileHolding = async (
      question: string,
    ): Promise<VoiceLookupReply> => {
      let failure: string;
      try {
        const answer = await within(
          askOwnerAssistant(authority, { question }, deps.db, { assistant }),
          ASK_HERMES_HOLD_MS,
        );
        if (answer !== null) {
          return {
            answered: true,
            cue: ownerCallHermesAnswerCue(answer),
            text: answer,
          };
        }
        failure = "timeout";
      } catch (error) {
        // Hermes's own failure was reported by its adapter (lib/hermes);
        // anything else is reported here.
        if (!(error instanceof DomainSideEffectError)) {
          reportError(error, {
            ids: { callId: authority.callId },
            source: "voice-agent:ask-hermes",
          });
        }
        failure = error instanceof Error ? error.name : "error";
      }
      const handoffId = await note({
        callBack: true,
        request: question,
        source: "hold_failed",
        timing: null,
      });
      return {
        answered: handoffId !== null,
        cue: handoffId ? OWNER_CALL_HOLD_FAILED_CUE : OWNER_CALL_HOLD_LOST_CUE,
        failure,
        text: handoffId ? `noted for a call back (handoff ${handoffId})` : null,
      };
    };
    return {
      callerClass: "owner",
      cues: {
        lookupFailed: OWNER_CALL_LOOKUP_FAILED_CUE,
        silenceFollowUp: OWNER_CALL_SILENCE_FOLLOW_UP_CUE,
        silenceGoodbye: OWNER_CALL_SILENCE_GOODBYE_CUE,
        wrapUp: OWNER_CALL_WRAP_UP_CUE,
      },
      silence: OWNER_CALL_SILENCE_POLICY,
      desk: { canAskAssistant, kind: "owner_call" },
      greetingCue: ownerCallGreetingCue(briefing),
      instructions: voiceAgentOwnerCallInstructions(briefing, {
        canAskAssistant,
        caller: access?.context ?? null,
      }),
      hold: holdAudio ? { audio: holdAudio, lookups: [ASK_HERMES] } : null,
      lookup: async (request): Promise<string | VoiceLookupReply> => {
        if (request.name === "ask_hermes") {
          return askWhileHolding(request.question);
        }
        if (request.name === "hand_to_hermes") {
          const timing = request.timing?.trim() || null;
          const handoffId = await note({
            callBack: request.call_back,
            request: request.request,
            source: "owner",
            timing,
          });
          return handoffId
            ? {
                answered: true,
                cue: ownerCallHandedCue({
                  callBack: request.call_back,
                  timing,
                }),
                text: `noted (handoff ${handoffId})`,
              }
            : {
                answered: false,
                cue: OWNER_CALL_HAND_FAILED_CUE,
                failure: "not_noted",
                text: null,
              };
        }
        if (!runCatalogue) throw new Error("No lookups on this call.");
        return runCatalogue(request);
      },
      // Noting a request for Hermes needs nothing connected: it is kept for
      // Hermes to pick up whether or not Royal can reach it.
      lookups: [
        ...catalogue,
        ...(canAskAssistant ? [ASK_HERMES_DEFINITION] : []),
        HAND_TO_HERMES_DEFINITION,
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
