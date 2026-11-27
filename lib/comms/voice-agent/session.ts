import {
  VOICE_AGENT_GREETING_CUE,
  VOICE_AGENT_SILENCE_FOLLOW_UP_CUE,
  VOICE_AGENT_SILENCE_GOODBYE_CUE,
  VOICE_AGENT_SILENCE_GOODBYE_TIMEOUT_SECONDS,
  VOICE_AGENT_SILENCE_OUTCOME,
  VOICE_AGENT_SILENCE_SECONDS,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
  VOICE_AGENT_WRAP_UP_SECONDS,
  VOICE_DELEGATION_NOTHING_TO_RUN_CUE,
  VOICE_LOOKUP_FAILED_CUE,
  voiceAgentInstructions,
  voiceLookupResultCue,
  voiceSilenceCallerSpoke,
  voiceSilenceCheck,
  voiceSilenceLimits,
  voiceSilenceStart,
  type VoiceAgentTurn,
  type VoiceSilencePolicy,
  type VoiceSilenceState,
} from "@/lib/domain/comms/calls/voice-agent";
import type {
  VoiceLookupDefinition,
  VoiceLookupRequest,
} from "@/lib/domain/comms/callers/lookups";
import {
  AGENT_CALL_EVENT,
  type AgentCallEventInput,
} from "@/lib/domain/comms/calls/agent-events";
import type { AgentOutcome, CommsProviderName } from "@/lib/domain/ports/comms";

import type { DeskDecision, DeskMode } from "./desk";
import {
  carrierClearFrame,
  carrierMediaFrame,
  parseCarrierFrame,
} from "./frames";
import type { LiveClientEvent, LiveConnection, LiveServerEvent } from "./live";
import { VOICE_AGENT_MODEL } from "./settings";
import { verifyStreamToken, type StreamTokenClaims } from "./token";

// One phone call with Mili: the carrier's media stream on one side, GPT-Live
// on AI Gateway on the other (stream-handler.ts wires the sockets), and the
// call desk (desk.ts) deciding when the call moves on.
//
//   carrier opens the socket → "start" frame → token checked
//   → caller resolved (who they are, their briefing, their lookups) while
//     Live opens → Live started as Mili for that caller
//   → session started → greeting cue sent → Mili greets first
//   → μ-law audio both ways, transcripts kept
//   → after each thing she says (or a Live delegation) the desk is asked
//   → desk: a lookup (admins only), whose answer Mili then reads out, or
//     end_call / transfer_to_team; caller hangs up, time, or a failure
//   → a lookup the caller holds for (a question to Hermes on an owner call):
//     hold music plays until the answer is back, and stops the moment Mili
//     speaks
//   → the caller silent after she has finished: she follows up, and after
//     enough unanswered follow-ups says goodbye and the call ends (when and
//     what is the domain's voiceSilenceCheck; the timers are here)
//   → outcome reported (the call router decides what the caller hears next)
//   → sockets closed
//
// Both carriers stream 8 kHz μ-law and GPT-Live speaks it too, so the audio
// passes through untouched. Written against tiny socket and timer interfaces
// so every branch can be driven by a test. The session never decides
// anything about the call itself: it reports an outcome, and lib/domain does
// the rest.

export type TextSocket = {
  send(text: string): void;
  close(): void;
};

export type VoiceAgentReportBody = {
  readonly callId: string;
  readonly callControlId: string;
  readonly provider: CommsProviderName;
  readonly outcome: AgentOutcome;
  readonly turns: readonly VoiceAgentTurn[];
};

/**
 * What a lookup can hand back instead of plain text: the exact cue for Mili,
 * for a result that is not "here is the answer" (a request noted for later,
 * a fallback when the answer never came).
 */
export type VoiceLookupReply = {
  readonly cue: string;
  /** What came back, for the call's event log. */
  readonly text: string | null;
  /** False: it may be asked again; true: it is done for this call. */
  readonly answered: boolean;
  readonly failure?: string | null;
};

/** Music for a caller holding on a lookup: 8 kHz μ-law, looped. */
export type VoiceHoldMusic = {
  readonly audio: Uint8Array;
  /** The lookups the caller holds for. */
  readonly lookups: readonly string[];
};

/**
 * What Mili is given about this caller, decided once before her session
 * starts (lib/domain/comms/callers/access.ts). A resolver that fails or is
 * slow leaves her with MESSAGE_ONLY_SETUP: message taking, no briefing, no
 * lookups. Nothing ever falls back to more.
 */
export type VoiceCallerSetup = {
  /** Who she is answering, for the call's summary line only. */
  readonly callerClass?: string;
  readonly instructions: string;
  /** What makes Mili open the call: by name for a caller resolved by name. */
  readonly greetingCue: string;
  /** The desk's lookup tools for this caller. */
  readonly lookups: readonly VoiceLookupDefinition[];
  /** Runs one lookup for this caller and resolves to what Mili may say. */
  readonly lookup:
    | ((request: VoiceLookupRequest) => Promise<string | VoiceLookupReply>)
    | null;
  /** Music while the caller holds on a slow lookup. Absent: silence. */
  readonly hold?: VoiceHoldMusic | null;
  /**
   * A briefing call Mili placed to the owner (owner-call.ts): the desk
   * offers no transfer, and her wrap-up and silence words are the owner
   * call's. Absent: an inbound call.
   */
  readonly desk?: DeskMode;
  /** How long a silent caller is given; absent, the inbound policy. */
  readonly silence?: VoiceSilencePolicy;
  readonly cues?: {
    /** A lookup that could not be run; absent, VOICE_LOOKUP_FAILED_CUE. */
    readonly lookupFailed?: string;
    readonly wrapUp: string;
    readonly silenceFollowUp: string;
    readonly silenceGoodbye: string;
  };
};

/**
 * Where the session hands what the call desk did (a lookup and its answer,
 * ending the call, how the session ended). `emit` must return at once: the
 * writer stores events off the conversation's path (event-writer.ts), and
 * `flush` is awaited only once the call has been reported.
 */
export type VoiceAgentEventSink = {
  emit(
    call: { readonly callId: string; readonly providerCallId: string },
    event: AgentCallEventInput,
  ): void;
  flush(): Promise<void>;
};

export const MESSAGE_ONLY_SETUP: VoiceCallerSetup = {
  callerClass: "unknown",
  greetingCue: VOICE_AGENT_GREETING_CUE,
  instructions: voiceAgentInstructions(),
  lookup: null,
  lookups: [],
};

export type VoiceAgentSessionDeps = {
  readonly dialect: CommsProviderName;
  /** Telnyx carries the token on the URL; Twilio in its "start" frame. */
  readonly urlToken: string | null;
  readonly secret: string;
  readonly voice: string;
  readonly carrier: TextSocket;
  /** Open the Live socket; its frames come back through `handleModelEvent`. */
  readonly openModel: () => Promise<LiveConnection>;
  /**
   * Who is calling and what Mili may use. Absent: every caller is unknown
   * (message taking only).
   */
  readonly prepare?: (claims: StreamTokenClaims) => Promise<VoiceCallerSetup>;
  /** The call desk: should the call move on, or is Mili waiting on a lookup? */
  readonly decide: (
    turns: readonly VoiceAgentTurn[],
    lookups: readonly VoiceLookupDefinition[],
    mode?: DeskMode,
  ) => Promise<DeskDecision>;
  readonly report: (body: VoiceAgentReportBody) => Promise<void>;
  /**
   * Keep what has been said so far on the call (agent-transcript.ts), so a
   * final report that never lands still leaves the transcript (#605).
   */
  readonly checkpoint?: (
    body: Omit<VoiceAgentReportBody, "outcome">,
  ) => Promise<void>;
  /** What the desk did on the call. Absent: nothing is kept. */
  readonly events?: VoiceAgentEventSink;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

/** Without a "start" frame by then, the socket is not a call. */
export const START_TIMEOUT_MS = 10_000;
/** Live must be ready by then, or the caller goes to a person. */
export const MODEL_STARTUP_TIMEOUT_MS = 12_000;
/**
 * Live started but Mili has not said a word by then: cue her greeting again.
 * The caller has heard nothing since the declaration (#608).
 */
export const GREETING_RETRY_MS = 4_500;
/**
 * Still nothing by then: the caller goes to a person rather than sitting in
 * silence. One caller hung up after 11.5 s of it.
 */
export const GREETING_GIVE_UP_MS = 9_000;
/** The transcript is kept on the call at most this often while she talks. */
export const CHECKPOINT_INTERVAL_MS = 5_000;
/** Without the caller resolved by then, Mili starts as for an unknown caller. */
export const PREPARE_TIMEOUT_MS = 4_000;
/** A lookup slower than this is told to Mili as one that could not be done. */
export const LOOKUP_TIMEOUT_MS = 6_000;
/** No speech from Mili for this long: she has finished what she was saying. */
export const TURN_QUIET_MS = 700;
/**
 * A pause longer than this starts a new turn for the same speaker. Live is
 * full duplex: the caller and Mili overlap (she says "okay" while they talk),
 * so a speaker's words join up by time, not by who spoke last.
 */
export const TURN_GAP_MS = 1_000;
/** 8 kHz μ-law: one byte a sample. */
const PHONE_BYTES_PER_MS = 8;
/** A sample louder than this (of 32,124) is not line hiss. */
const SPEECH_FLOOR = 600;
/** A chunk is speech when at least this share of its samples is. */
const SPEECH_SHARE = 0.1;
/** A 20 ms frame of phone audio. */
const FRAME_BYTES = PHONE_BYTES_PER_MS * 20;
/** A caller silent this long after Mili has finished is followed up. */
export const CALLER_SILENCE_MS = VOICE_AGENT_SILENCE_SECONDS * 1000;
/** Mili never saying the silence goodbye: the call ends anyway after this. */
export const SILENCE_GOODBYE_TIMEOUT_MS =
  VOICE_AGENT_SILENCE_GOODBYE_TIMEOUT_SECONDS * 1000;
/** After Mili's last word, before hanging up or transferring. */
const PLAYBACK_TAIL_MS = 600;
const MAX_PLAYBACK_WAIT_MS = 15_000;
/** Hold music starts this long after Mili's "one moment" has played. */
export const HOLD_LEAD_MS = 400;
/** Hold music is kept this far ahead of the carrier, and topped up this often. */
const HOLD_BUFFER_MS = 600;
const HOLD_TICK_MS = 200;

/** The first frame on the Live socket: who Mili is and how she sounds. */
export function voiceAgentLiveStart(
  voice: string,
  instructions: string = MESSAGE_ONLY_SETUP.instructions,
): LiveClientEvent {
  return {
    session: {
      audio: {
        format: { rate: 8000, type: "audio/pcmu" },
        output: { voice },
      },
      delegation: { type: "client" },
      instructions,
      model: VOICE_AGENT_MODEL,
      store: false,
    },
    type: "session.start",
  };
}

/** The loudness of one μ-law sample (G.711), 0 to 32,124. */
function muLawMagnitude(byte: number): number {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  return (((mantissa << 3) + 0x84) << exponent) - 0x84;
}

/**
 * GPT-Live sends audio the whole time, silence included, so "she stopped
 * sending audio" never happens: speech is told from silence by level.
 */
export function isSpeech(audio: Uint8Array): boolean {
  if (audio.length === 0) return false;
  let loud = 0;
  for (const byte of audio) if (muLawMagnitude(byte) > SPEECH_FLOOR) loud += 1;
  return loud / audio.length >= SPEECH_SHARE;
}

type SpokenTurn = VoiceAgentTurn & {
  readonly startMs: number | null;
  readonly endMs: number | null;
  /** Arrival order, for turns without timestamps. */
  readonly seq: number;
};

/**
 * What the desk's answer to a Live delegation tells Mili. Always a final
 * answer: one that reads as progress leaves Live waiting in silence (#606).
 */
function deskNote(decision: DeskDecision): string {
  if (decision?.action === "end")
    return "The call desk is ending the call now.";
  if (decision?.action === "transfer")
    return "The call desk is putting the caller through to the team now.";
  return VOICE_DELEGATION_NOTHING_TO_RUN_CUE;
}

/** What happened on one call, for the summary line. Never what was said. */
type SessionStats = {
  /** Session clock times; null until it happened. */
  startFrameAt: number | null;
  liveOpenAt: number | null;
  setupAt: number | null;
  startedAt: number | null;
  firstWordsAt: number | null;
  setupTimedOut: boolean;
  greetingRetried: boolean;
  delegations: number;
  deskAsks: number;
  deskFailures: number;
  lookups: number;
  followUps: number;
  checkpoints: number;
};

export class VoiceAgentSession {
  private readonly deps: VoiceAgentSessionDeps;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private claims: StreamTokenClaims | null = null;
  private streamId: string | null = null;
  private model: LiveConnection | null = null;
  private ready = false;
  private finished = false;
  private ending = false;
  private readonly timers = new Set<unknown>();
  /** When the audio queued at the carrier has all played. */
  private playbackEndsAt = 0;
  /** When the last of Mili's speech (not silence) has played. */
  private speechEndsAt = 0;
  private quietTimer: unknown = null;
  private deskBusy = false;
  private deskAgain = false;
  private pendingDelegation: string | null = null;
  private readonly spoken: SpokenTurn[] = [];
  private setup: VoiceCallerSetup = MESSAGE_ONLY_SETUP;
  /** Lookups already answered on this call, so the desk never repeats one. */
  private readonly lookupsRun = new Set<string>();
  /** Caller silence: follow-ups sent, and whether the goodbye is under way. */
  private silence: VoiceSilenceState = voiceSilenceStart(0);
  /** Ends a silent caller's call if Mili never says her goodbye. */
  private silenceGoodbyeTimer: unknown = null;
  /** Hold music: playing, where in the loop, and how far ahead it is queued. */
  private holding = false;
  /** Which hold the pump timer belongs to: an old hold's timer stops. */
  private holdRun = 0;
  private holdPosition = 0;
  private holdQueuedUntil = 0;
  /** Music is queued at the carrier that a "clear" would drop. */
  private holdQueued = false;
  /** When the transcript was last kept on the call, and how long it was. */
  private checkpointedAt = Number.NEGATIVE_INFINITY;
  private checkpointedLength = 0;
  /**
   * The checkpoint writes, one after another: a slow write finishing after a
   * newer one would put the older transcript back. `finish` waits for it, so
   * the function stays alive (waitUntil) until the last one has landed.
   */
  private checkpoints: Promise<void> = Promise.resolve();
  private readonly stats: SessionStats = {
    checkpoints: 0,
    delegations: 0,
    deskAsks: 0,
    deskFailures: 0,
    firstWordsAt: null,
    followUps: 0,
    greetingRetried: false,
    liveOpenAt: null,
    lookups: 0,
    setupAt: null,
    setupTimedOut: false,
    startFrameAt: null,
    startedAt: null,
  };

  /** In the order spoken. */
  get turns(): VoiceAgentTurn[] {
    return [...this.spoken]
      .sort(
        (a, b) =>
          (a.startMs ?? Number.POSITIVE_INFINITY)
            - (b.startMs ?? Number.POSITIVE_INFINITY) || a.seq - b.seq,
      )
      .map(({ speaker, text }) => ({ speaker, text: text.trim() }))
      .filter((turn) => turn.text.length > 0);
  }
  /** Settles once the session has reported and closed, or was turned away. */
  readonly done: Promise<void>;
  private settle: () => void = () => {};

  constructor(deps: VoiceAgentSessionDeps) {
    this.deps = deps;
    this.log = deps.log ?? console;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer
      ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.after(START_TIMEOUT_MS, () => {
      if (!this.claims) this.abandon("no start frame");
    });
  }

  // ── Carrier ──────────────────────────────────────────────────────────

  handleCarrierText(raw: string): void {
    if (this.finished) return;
    const frame = parseCarrierFrame(this.deps.dialect, raw);
    switch (frame.kind) {
      case "start":
        void this.start(frame.providerCallId, frame.streamId, frame.token);
        return;
      case "media":
        this.forwardCallerAudio(frame.payload);
        return;
      case "stop":
        this.handleCarrierClosed();
        return;
      default:
        return;
    }
  }

  /** The carrier hung up the stream: the caller left, or the app moved the call on. */
  handleCarrierClosed(): void {
    if (!this.claims) {
      this.abandon("stream closed before it started");
      return;
    }
    void this.finish("completed");
  }

  private async start(
    providerCallId: string | null,
    streamId: string | null,
    frameToken: string | null,
  ): Promise<void> {
    if (this.claims) return;
    const claims = verifyStreamToken(
      this.deps.urlToken ?? frameToken,
      this.deps.secret,
      new Date(this.now()),
    );
    if (
      !claims
      || claims.provider !== this.deps.dialect
      || !providerCallId
      || claims.callControlId !== providerCallId
    ) {
      this.abandon("stream token rejected");
      return;
    }
    this.claims = claims;
    this.streamId = streamId;
    this.stats.startFrameAt = this.now();
    this.after(
      Math.max(0, claims.maxSeconds - VOICE_AGENT_WRAP_UP_SECONDS) * 1000,
      () => {
        if (this.ready && !this.ending) {
          this.sendModel({
            content: this.setup.cues?.wrapUp ?? VOICE_AGENT_WRAP_UP_INSTRUCTION,
            delegation_id: null,
            type: "session.instructions.append",
          });
        }
      },
    );
    this.after(claims.maxSeconds * 1000, () => {
      this.log.info("[voice-agent] conversation reached its time limit.");
      void this.finish("completed");
    });
    this.after(MODEL_STARTUP_TIMEOUT_MS, () => {
      if (!this.ready) {
        this.log.warn("[voice-agent] GPT-Live did not start in time.");
        void this.finish("failed");
      }
    });
    // Who is calling is worked out while Live opens, so it costs no time.
    const setup = this.prepareCaller(claims);
    try {
      this.model = await this.deps.openModel();
    } catch (error) {
      this.log.error(
        "[voice-agent] could not open the GPT-Live session.",
        error instanceof Error ? error.message : error,
      );
      void this.finish("failed");
      return;
    }
    this.stats.liveOpenAt = this.now();
    // The caller may have hung up while Live opened: close it now rather than
    // keeping a billed session open while the caller is still being resolved.
    if (this.finished) {
      this.model.close();
      return;
    }
    this.setup = await setup;
    this.stats.setupAt = this.now();
    if (this.finished) {
      this.model.close();
      return;
    }
    this.sendModel(
      voiceAgentLiveStart(this.deps.voice, this.setup.instructions),
    );
    this.emit(AGENT_CALL_EVENT.sessionStarted, {
      callerClass: this.setup.callerClass ?? "unknown",
      lookups: this.setup.lookups.map((lookup) => lookup.name),
      ownerCall: this.setup.desk?.kind === "owner_call",
      setupTimedOut: this.stats.setupTimedOut,
    });
  }

  /** The caller's setup, or message taking if it fails or is slow. */
  private async prepareCaller(
    claims: StreamTokenClaims,
  ): Promise<VoiceCallerSetup> {
    const prepare = this.deps.prepare;
    if (!prepare) return MESSAGE_ONLY_SETUP;
    try {
      const setup = await this.within(prepare(claims), PREPARE_TIMEOUT_MS);
      if (setup) return setup;
      // Not silent: a known caller (an admin, a client) is about to be
      // answered as a stranger, and nothing else would say why (#612).
      this.stats.setupTimedOut = true;
      this.log.error(
        `[voice-agent] the caller was not resolved within ${PREPARE_TIMEOUT_MS} ms; taking a message.`,
      );
      return MESSAGE_ONLY_SETUP;
    } catch (error) {
      this.log.warn(
        `[voice-agent] the caller could not be resolved (${
          error instanceof Error ? error.name : "error"
        }); taking a message.`,
      );
      return MESSAGE_ONLY_SETUP;
    }
  }

  /** The promise's value, or null if it takes longer than `ms`. */
  private within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const timer = this.after(ms, () => resolve(null));
      const settled = () => {
        this.clearTimer(timer);
        this.timers.delete(timer);
      };
      promise.then(
        (value) => {
          settled();
          resolve(value);
        },
        (error: unknown) => {
          settled();
          reject(error);
        },
      );
    });
  }

  private forwardCallerAudio(payload: string): void {
    if (!this.ready || this.ending || !this.model) return;
    this.sendModel({ audio: payload, type: "session.input_audio.append" });
    if (isSpeech(Buffer.from(payload, "base64"))) this.callerSpoke();
  }

  // ── GPT-Live ─────────────────────────────────────────────────────────

  handleModelEvent(event: LiveServerEvent): void {
    if (this.finished) return;
    switch (event.type) {
      case "session.started":
        if (this.ready) return;
        this.ready = true;
        // Without this cue she waits for the caller to speak first.
        this.sendModel({
          content: this.setup.greetingCue,
          delegation_id: null,
          type: "session.commentary.append",
        });
        this.silence = voiceSilenceStart(this.now());
        this.stats.startedAt = this.now();
        this.watchSilence(
          voiceSilenceLimits(this.silence, this.setup.silence).ms,
        );
        this.watchGreeting();
        this.checkpointEvery(CHECKPOINT_INTERVAL_MS);
        return;
      case "session.output_audio.delta":
        // Once the call is moving on there is nothing left to ask the desk.
        if (this.playToCaller(event.delta) && !this.ending) {
          this.restartQuietTimer();
        }
        return;
      case "session.input_transcript.delta":
        this.appendFragment("caller", event.delta, event.startMs, event.endMs);
        if (event.delta.trim()) this.callerSpoke();
        return;
      case "session.output_transcript.delta":
        this.appendFragment("agent", event.delta, event.startMs, event.endMs);
        if (!this.ending) this.restartQuietTimer();
        return;
      case "session.delegation.created":
        this.stats.delegations += 1;
        void this.askDesk(event.delegationId);
        return;
      case "error":
        this.log.warn(
          `[voice-agent] GPT-Live reported an error (${event.code ?? "no code"}).`,
        );
        if (!this.ready) void this.finish("failed");
        return;
      case "session.closed":
        if (!this.ending) {
          void this.finish(this.turns.length > 0 ? "completed" : "failed");
        }
        return;
      default:
        return;
    }
  }

  /** The Live socket closed. Mid-conversation that is a failure: the caller is still there. */
  handleModelClosed(): void {
    if (this.finished || this.ending) return;
    this.log.warn("[voice-agent] the GPT-Live session closed unexpectedly.");
    void this.finish("failed");
  }

  /** Queue her audio at the carrier; true when it was speech. */
  private playToCaller(base64MuLaw: string): boolean {
    const audio = Buffer.from(base64MuLaw, "base64");
    const speech = isSpeech(audio);
    if (this.holding) {
      // On hold, Live's background silence is not sent: the carrier plays
      // what it is given in order, so it would hold the music up. If she
      // speaks, the music queued ahead of her is dropped, and everything she
      // sends until shortly after her last word goes through — the pauses
      // inside what she says are part of it. The music picks up after that.
      const midTurn = this.now() < this.speechEndsAt + HOLD_LEAD_MS;
      if (!speech && !midTurn) return false;
      if (speech) this.clearHoldAudio();
    }
    for (let offset = 0; offset < audio.length; offset += FRAME_BYTES) {
      this.deps.carrier.send(
        carrierMediaFrame(
          this.deps.dialect,
          this.streamId,
          audio.subarray(offset, offset + FRAME_BYTES).toString("base64"),
        ),
      );
    }
    this.playbackEndsAt =
      Math.max(this.playbackEndsAt, this.now())
      + audio.length / PHONE_BYTES_PER_MS;
    if (speech) {
      this.speechEndsAt = this.playbackEndsAt;
      this.stats.firstWordsAt ??= this.now();
    }
    return speech;
  }

  /**
   * A transcript delta joins the speaker's current turn unless they paused
   * for longer than TURN_GAP_MS; the other speaker talking over them in
   * between does not split it.
   */
  private appendFragment(
    speaker: VoiceAgentTurn["speaker"],
    delta: string,
    startMs: number | null,
    endMs: number | null,
  ): void {
    let index = -1;
    for (let i = this.spoken.length - 1; i >= 0; i -= 1) {
      if (this.spoken[i].speaker === speaker) {
        index = i;
        break;
      }
    }
    const open = index >= 0 ? this.spoken[index] : null;
    const continues =
      open !== null
      && (startMs === null
        || open.endMs === null
        || startMs - open.endMs <= TURN_GAP_MS);
    if (open && continues) {
      this.spoken[index] = {
        ...open,
        endMs: endMs ?? open.endMs,
        text: `${open.text}${delta}`,
      };
      return;
    }
    if (!delta.trim()) return;
    this.spoken.push({
      endMs,
      seq: this.spoken.length,
      speaker,
      startMs,
      text: delta,
    });
  }

  // ── The call desk ────────────────────────────────────────────────────

  private restartQuietTimer(): void {
    if (this.quietTimer !== null) {
      this.clearTimer(this.quietTimer);
      this.timers.delete(this.quietTimer);
    }
    this.quietTimer = this.after(TURN_QUIET_MS, () => {
      this.quietTimer = null;
      // Her goodbye to a silent caller is done: nothing left to ask the desk.
      if (this.silence.saidGoodbye) {
        this.moveOn(VOICE_AGENT_SILENCE_OUTCOME);
        return;
      }
      this.checkpointTranscript();
      void this.askDesk(null);
    });
  }

  /** Ask the desk whether the call moves on; one question at a time. */
  private async askDesk(delegationId: string | null): Promise<void> {
    if (this.finished || this.ending) return;
    if (this.deskBusy) {
      this.deskAgain = true;
      this.pendingDelegation = delegationId ?? this.pendingDelegation;
      return;
    }
    this.deskBusy = true;
    this.stats.deskAsks += 1;
    let decision: DeskDecision = null;
    try {
      decision = await this.deps.decide(
        [...this.turns],
        this.setup.lookups,
        this.setup.desk,
      );
    } catch (error) {
      this.stats.deskFailures += 1;
      // The caller can still hang up, and the time limit still ends the
      // call; the next thing Mili says asks again.
      this.log.warn(
        "[voice-agent] the call desk did not answer.",
        error instanceof Error ? error.message : error,
      );
      this.emit(AGENT_CALL_EVENT.deskFailed, {
        error: error instanceof Error ? error.name : "error",
      });
    }
    let lookup: {
      readonly key: string;
      readonly cue: string;
      readonly answered: boolean;
    } | null = null;
    if (decision?.action === "lookup") {
      const key = JSON.stringify(decision.request);
      if (this.lookupsRun.has(key)) {
        decision = null;
      } else {
        this.stats.lookups += 1;
        const startedAt = this.now();
        const held = this.holdsFor(decision.request.name);
        if (held) this.startHold();
        const ran = await this.runLookup(decision.request);
        this.stopHold();
        lookup = { answered: ran.answered, cue: ran.cue, key };
        const { name, ...args } = decision.request;
        this.emit(AGENT_CALL_EVENT.deskLookup, {
          answer: ran.text,
          answered: ran.answered,
          args,
          delegated: delegationId !== null,
          failure: ran.failure,
          ...(held ? { held: true } : {}),
          ms: this.now() - startedAt,
          name,
        });
      }
    } else if (decision?.action === "end") {
      this.emit(AGENT_CALL_EVENT.deskEndCall);
    } else if (decision?.action === "transfer") {
      this.emit(AGENT_CALL_EVENT.deskTransfer, { reason: decision.reason });
    }
    this.deskBusy = false;
    if (this.finished || this.ending) return;
    if (lookup !== null) {
      // Commentary makes her speak; a delegation is answered on its own id.
      const delivered = this.sendModel({
        content: lookup.cue,
        delegation_id: delegationId,
        type: delegationId
          ? "session.thinking.append"
          : "session.commentary.append",
      });
      // Only an answer Mili was actually handed is never run again. One that
      // failed, timed out or never reached her stays askable: the caller
      // asking again must get another try, not a "let me check" followed by
      // silence.
      if (lookup.answered && delivered) this.lookupsRun.add(lookup.key);
    } else if (delegationId) {
      this.sendModel({
        content: deskNote(decision),
        delegation_id: delegationId,
        type: "session.thinking.append",
      });
    }
    if (decision && decision.action !== "lookup") {
      this.moveOn(decision.action === "end" ? "completed" : "transfer");
      return;
    }
    if (this.deskAgain) {
      const next = this.pendingDelegation;
      this.deskAgain = false;
      this.pendingDelegation = null;
      void this.askDesk(next);
    }
  }

  /**
   * Run a lookup the desk asked for, as the domain allows it for this caller.
   * Any refusal, failure or timeout becomes "could not check" — never "found
   * nothing", and never an answer from somewhere wider.
   */
  private async runLookup(request: VoiceLookupRequest): Promise<{
    readonly cue: string;
    readonly answered: boolean;
    /** What came back, for the call's event log. */
    readonly text: string | null;
    readonly failure: string | null;
  }> {
    const failed = (failure: string) => ({
      answered: false,
      cue: this.setup.cues?.lookupFailed ?? VOICE_LOOKUP_FAILED_CUE,
      failure,
      text: null,
    });
    const lookup = this.setup.lookup;
    const definition = this.setup.lookups.find((l) => l.name === request.name);
    if (!lookup || !definition) return failed("not_offered");
    try {
      const text = await this.within(
        lookup(request),
        definition.timeoutMs ?? LOOKUP_TIMEOUT_MS,
      );
      if (text === null) {
        this.log.warn(`[voice-agent] lookup ${request.name} timed out.`);
        return failed("timeout");
      }
      if (typeof text !== "string") {
        return {
          answered: text.answered,
          cue: text.cue,
          failure: text.failure ?? null,
          text: text.text,
        };
      }
      return {
        answered: true,
        cue: voiceLookupResultCue(text),
        failure: null,
        text,
      };
    } catch (error) {
      // The name only: what was asked and what came back stay off the logs.
      const name = error instanceof Error ? error.name : "error";
      this.log.warn(`[voice-agent] lookup ${request.name} failed (${name}).`);
      return failed(name);
    }
  }

  // ── Hold music ───────────────────────────────────────────────────────

  private holdsFor(name: string): boolean {
    return Boolean(this.setup.hold?.lookups.includes(name));
  }

  /**
   * The caller is holding on a lookup: play the music once her "one moment"
   * has finished, a little ahead of the carrier, until stopHold. The silence
   * watcher already waits while the desk is busy, so nobody is asked "are
   * you still there?" mid-hold.
   */
  private startHold(): void {
    const hold = this.setup.hold;
    if (!hold || hold.audio.length < FRAME_BYTES || this.holding) return;
    this.holding = true;
    this.holdRun += 1;
    this.holdQueuedUntil = 0;
    this.pumpHold(this.holdRun);
  }

  private pumpHold(run: number): void {
    const audio = this.setup.hold?.audio;
    if (
      !this.holding
      || run !== this.holdRun
      || this.finished
      || this.ending
      || !audio
    ) {
      return;
    }
    const now = this.now();
    if (now >= this.speechEndsAt + HOLD_LEAD_MS) {
      // After anything of hers still queued at the carrier.
      let queued = Math.max(this.holdQueuedUntil, this.playbackEndsAt, now);
      while (queued - now < HOLD_BUFFER_MS) {
        if (this.holdPosition + FRAME_BYTES > audio.length) {
          this.holdPosition = 0;
        }
        const frame = audio.subarray(
          this.holdPosition,
          this.holdPosition + FRAME_BYTES,
        );
        this.holdPosition += FRAME_BYTES;
        this.deps.carrier.send(
          carrierMediaFrame(
            this.deps.dialect,
            this.streamId,
            Buffer.from(frame).toString("base64"),
          ),
        );
        queued += FRAME_BYTES / PHONE_BYTES_PER_MS;
        this.holdQueued = true;
      }
      this.holdQueuedUntil = queued;
    }
    this.after(HOLD_TICK_MS, () => this.pumpHold(run));
  }

  /** Drop the music queued at the carrier, so what comes next plays at once. */
  private clearHoldAudio(): void {
    if (this.holdQueued) {
      this.deps.carrier.send(
        carrierClearFrame(this.deps.dialect, this.streamId),
      );
      this.holdQueued = false;
    }
    this.holdQueuedUntil = 0;
  }

  private stopHold(): void {
    if (!this.holding) return;
    this.holding = false;
    this.clearHoldAudio();
  }

  // ── A silent caller ──────────────────────────────────────────────────

  /**
   * The caller is talking again. Line noise loud enough to pass as speech
   * counts too: holding off a follow-up is better than talking over them.
   * A goodbye cued but not yet moving the call on is called off, and the
   * silence is watched again from here.
   */
  private callerSpoke(): void {
    if (this.finished || this.ending) return;
    const calledOff = this.silence.saidGoodbye;
    this.silence = voiceSilenceCallerSpoke(this.silence, this.now());
    if (!calledOff) return;
    if (this.silenceGoodbyeTimer !== null) {
      this.clearTimer(this.silenceGoodbyeTimer);
      this.timers.delete(this.silenceGoodbyeTimer);
      this.silenceGoodbyeTimer = null;
    }
    this.watchSilence(CALLER_SILENCE_MS);
  }

  private watchSilence(ms: number): void {
    this.after(ms, () => this.checkSilence());
  }

  /** Act on the domain's silence decision: a cue, a goodbye, or another wait. */
  private checkSilence(): void {
    if (this.finished || this.ending) return;
    const { action, state } = voiceSilenceCheck(this.silence, {
      agentSpeechEndsAt: this.speechEndsAt,
      busy: this.deskBusy,
      now: this.now(),
      policy: this.setup.silence,
    });
    this.silence = state;
    switch (action.kind) {
      case "wait":
        this.watchSilence(action.ms);
        return;
      case "follow_up":
        this.stats.followUps += 1;
        this.sendModel({
          content:
            this.setup.cues?.silenceFollowUp
            ?? VOICE_AGENT_SILENCE_FOLLOW_UP_CUE,
          delegation_id: null,
          type: "session.commentary.append",
        });
        this.watchSilence(action.ms);
        return;
      case "goodbye":
        this.log.info(
          "[voice-agent] the caller stayed silent; ending the call.",
        );
        this.sendModel({
          content:
            this.setup.cues?.silenceGoodbye ?? VOICE_AGENT_SILENCE_GOODBYE_CUE,
          delegation_id: null,
          type: "session.commentary.append",
        });
        // Her goodbye ending is what normally moves the call on (the quiet
        // timer); this ends it if she never says one.
        this.silenceGoodbyeTimer = this.after(
          SILENCE_GOODBYE_TIMEOUT_MS,
          () => {
            this.silenceGoodbyeTimer = null;
            if (this.silence.saidGoodbye) {
              this.moveOn(VOICE_AGENT_SILENCE_OUTCOME);
            }
          },
        );
        return;
      case "none":
        return;
    }
  }

  // ── Her greeting ─────────────────────────────────────────────────────

  /**
   * Live has started and been cued to greet. If she has not said a word a few
   * seconds on, cue her again; if she still has not, hand the caller to a
   * person — the caller has heard nothing since the declaration (#608).
   */
  private watchGreeting(): void {
    this.after(GREETING_RETRY_MS, () => {
      if (this.finished || this.ending || this.stats.firstWordsAt !== null) {
        return;
      }
      this.stats.greetingRetried = true;
      this.log.warn(
        `[voice-agent] Mili had not spoken ${GREETING_RETRY_MS} ms after Live started; cueing her greeting again.`,
      );
      this.sendModel({
        content: this.setup.greetingCue,
        delegation_id: null,
        type: "session.commentary.append",
      });
    });
    this.after(GREETING_GIVE_UP_MS, () => {
      if (this.finished || this.ending || this.stats.firstWordsAt !== null) {
        return;
      }
      this.log.warn(
        `[voice-agent] Mili had still not spoken ${GREETING_GIVE_UP_MS} ms after Live started; handing the caller to a person.`,
      );
      void this.finish("failed");
    });
  }

  // ── Keeping the transcript ───────────────────────────────────────────

  /**
   * Checkpoint on a clock as well as after each of her turns, so a caller
   * talking at length and then hanging up is kept too. Cleared with every
   * other timer when the session finishes.
   */
  private checkpointEvery(ms: number): void {
    this.after(ms, () => {
      if (this.finished) return;
      this.checkpointTranscript();
      this.checkpointEvery(ms);
    });
  }

  /**
   * Keep what has been said so far on the call, at most every
   * CHECKPOINT_INTERVAL_MS and only when there is more of it. The
   * conversation never waits on the database; the writes queue behind one
   * another, and one that fails is tried again next time.
   */
  private checkpointTranscript(): void {
    const checkpoint = this.deps.checkpoint;
    const claims = this.claims;
    if (!checkpoint || !claims || this.finished) return;
    const now = this.now();
    if (now - this.checkpointedAt < CHECKPOINT_INTERVAL_MS) return;
    const turns = this.turns;
    const length = turns.reduce((sum, turn) => sum + turn.text.length, 0);
    if (length <= this.checkpointedLength) return;
    this.checkpointedAt = now;
    this.stats.checkpoints += 1;
    const body = {
      callControlId: claims.callControlId,
      callId: claims.callId,
      provider: claims.provider,
      turns,
    };
    this.checkpoints = this.checkpoints.then(() =>
      checkpoint(body).then(
        () => {
          this.checkpointedLength = Math.max(this.checkpointedLength, length);
        },
        (error: unknown) => {
          this.log.warn(
            `[voice-agent] could not keep the transcript so far (${
              error instanceof Error ? error.name : "error"
            }).`,
          );
        },
      ),
    );
  }

  /** Let her last words finish playing (her speech, not the silence after), then hand the call back. */
  private moveOn(outcome: AgentOutcome): void {
    if (this.finished || this.ending) return;
    this.ending = true;
    const deadline = this.now() + MAX_PLAYBACK_WAIT_MS;
    const waitForPlayback = () => {
      const now = this.now();
      const playedOutAt = this.speechEndsAt;
      const remaining = Math.max(0, playedOutAt - now) + PLAYBACK_TAIL_MS;
      this.after(Math.min(remaining, Math.max(0, deadline - now)), () => {
        // More of her goodbye arrived while waiting: let that play too.
        if (this.speechEndsAt > playedOutAt && this.now() < deadline) {
          waitForPlayback();
          return;
        }
        void this.finish(outcome);
      });
    };
    waitForPlayback();
  }

  // ── Ending ───────────────────────────────────────────────────────────

  /** Hand an event to the sink. Never waits, and never throws into the call. */
  private emit(
    kind: AgentCallEventInput["kind"],
    detail: Record<string, unknown> = {},
  ): void {
    const sink = this.deps.events;
    const claims = this.claims;
    if (!sink || !claims) return;
    try {
      sink.emit(
        { callId: claims.callId, providerCallId: claims.callControlId },
        { at: new Date(this.now()), detail, kind },
      );
    } catch (error) {
      // A broken sink loses the log, never the call.
      this.log.warn(
        `[voice-agent] could not keep the ${kind} event.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** True once the event was handed to an open Live socket. */
  private sendModel(event: LiveClientEvent): boolean {
    if (!this.model) return false;
    try {
      this.model.send(event);
      return true;
    } catch (error) {
      this.log.warn(
        "[voice-agent] could not send to GPT-Live.",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  private after(ms: number, fn: () => void): unknown {
    const handle = this.setTimer(() => {
      this.timers.delete(handle);
      fn();
    }, ms);
    this.timers.add(handle);
    return handle;
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.clearTimer(handle);
    this.timers.clear();
  }

  private closeModel(): void {
    // Ends the voice session (and its per-hour billing) cleanly.
    this.sendModel({ type: "session.close" });
    this.model?.close();
  }

  /** Not a call we will serve: close without reporting anything. */
  private abandon(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.log.warn(`[voice-agent] closing a stream: ${reason}.`);
    this.closeModel();
    this.deps.carrier.close();
    this.settle();
  }

  /**
   * One line per call: how long each step took from the carrier's start
   * frame, and what the session did. No words, numbers or names — the line
   * exists so a slow greeting or a stalled call can be attributed (#608).
   */
  private summary(outcome: AgentOutcome): string {
    const s = this.stats;
    const at = (t: number | null) =>
      t === null || s.startFrameAt === null ? "-" : `${t - s.startFrameAt}ms`;
    const caller = s.setupTimedOut
      ? "unresolved-timeout"
      : (this.setup.callerClass ?? "unknown");
    return [
      `[voice-agent] call summary: outcome=${outcome}`,
      `caller=${caller}`,
      `liveOpen=${at(s.liveOpenAt)}`,
      `setup=${at(s.setupAt)}`,
      `started=${at(s.startedAt)}`,
      `firstWords=${at(s.firstWordsAt)}`,
      `ended=${at(this.now())}`,
      `turns=${this.turns.length}`,
      `delegations=${s.delegations}`,
      `desk=${s.deskAsks}`,
      `deskFailed=${s.deskFailures}`,
      `lookups=${s.lookups}`,
      `followUps=${s.followUps}`,
      `greetingRetried=${s.greetingRetried}`,
      `checkpoints=${s.checkpoints}`,
    ].join(" ");
  }

  /** Report once, then close both sides. */
  async finish(outcome: AgentOutcome): Promise<void> {
    if (this.finished || !this.claims) return;
    this.finished = true;
    this.ending = true;
    this.clearTimers();
    this.closeModel();
    this.log.info(this.summary(outcome));
    this.emit(AGENT_CALL_EVENT.sessionEnded, {
      deskAsks: this.stats.deskAsks,
      deskFailures: this.stats.deskFailures,
      followUps: this.stats.followUps,
      lookups: this.stats.lookups,
      outcome,
      seconds:
        this.stats.startFrameAt === null
          ? null
          : Math.round((this.now() - this.stats.startFrameAt) / 1000),
      turns: this.turns.length,
    });
    const claims = this.claims;
    try {
      await this.deps.report({
        callControlId: claims.callControlId,
        callId: claims.callId,
        outcome,
        provider: claims.provider,
        turns: this.turns,
      });
    } catch (error) {
      // Nothing more can be done from here: the stale-call sweep and the
      // carrier's own end-of-stream callback still settle the call.
      this.log.error(
        "[voice-agent] could not record how the conversation ended.",
        error instanceof Error ? error.message : error,
      );
    }
    // Closed after the report so the call has already been moved on.
    this.deps.carrier.close();
    // A checkpoint or event still writing finishes before the function may
    // stop. Neither delayed the conversation: they were written as it went.
    await this.checkpoints;
    await this.deps.events?.flush().catch(() => {});
    this.settle();
  }
}
