import {
  VOICE_AGENT_GREETING_CUE,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
  VOICE_AGENT_WRAP_UP_SECONDS,
  VOICE_LOOKUP_FAILED_CUE,
  voiceAgentInstructions,
  voiceLookupResultCue,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";
import type {
  VoiceLookupDefinition,
  VoiceLookupRequest,
} from "@/lib/domain/comms/callers/lookups";
import type { AgentOutcome, CommsProviderName } from "@/lib/domain/ports/comms";

import type { DeskDecision } from "./desk";
import { carrierMediaFrame, parseCarrierFrame } from "./frames";
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
 * What Mili is given about this caller, decided once before her session
 * starts (lib/domain/comms/callers/access.ts). A resolver that fails or is
 * slow leaves her with MESSAGE_ONLY_SETUP: message taking, no briefing, no
 * lookups. Nothing ever falls back to more.
 */
export type VoiceCallerSetup = {
  readonly instructions: string;
  /** The desk's lookup tools for this caller. */
  readonly lookups: readonly VoiceLookupDefinition[];
  /** Runs one lookup for this caller and resolves to what Mili may say. */
  readonly lookup: ((request: VoiceLookupRequest) => Promise<string>) | null;
};

export const MESSAGE_ONLY_SETUP: VoiceCallerSetup = {
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
  ) => Promise<DeskDecision>;
  readonly report: (body: VoiceAgentReportBody) => Promise<void>;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

/** Without a "start" frame by then, the socket is not a call. */
export const START_TIMEOUT_MS = 10_000;
/** Live must be ready by then, or the caller goes to a person. */
export const MODEL_STARTUP_TIMEOUT_MS = 15_000;
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
/** After Mili's last word, before hanging up or transferring. */
const PLAYBACK_TAIL_MS = 600;
const MAX_PLAYBACK_WAIT_MS = 15_000;

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

/** What the desk's answer to a Live delegation tells Mili. */
function deskNote(decision: DeskDecision): string {
  if (decision?.action === "end")
    return "The call desk is ending the call now.";
  if (decision?.action === "transfer")
    return "The call desk is putting the caller through to the team now.";
  return "The call desk has nothing to do yet; carry on with the caller.";
}

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
    this.after(
      Math.max(0, claims.maxSeconds - VOICE_AGENT_WRAP_UP_SECONDS) * 1000,
      () => {
        if (this.ready && !this.ending) {
          this.sendModel({
            content: VOICE_AGENT_WRAP_UP_INSTRUCTION,
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
    this.setup = await setup;
    if (this.finished) {
      this.model.close();
      return;
    }
    this.sendModel(
      voiceAgentLiveStart(this.deps.voice, this.setup.instructions),
    );
  }

  /** The caller's setup, or message taking if it fails or is slow. */
  private async prepareCaller(
    claims: StreamTokenClaims,
  ): Promise<VoiceCallerSetup> {
    const prepare = this.deps.prepare;
    if (!prepare) return MESSAGE_ONLY_SETUP;
    try {
      return (
        (await this.within(prepare(claims), PREPARE_TIMEOUT_MS))
        ?? MESSAGE_ONLY_SETUP
      );
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
          content: VOICE_AGENT_GREETING_CUE,
          delegation_id: null,
          type: "session.commentary.append",
        });
        return;
      case "session.output_audio.delta":
        // Once the call is moving on there is nothing left to ask the desk.
        if (this.playToCaller(event.delta) && !this.ending) {
          this.restartQuietTimer();
        }
        return;
      case "session.input_transcript.delta":
        this.appendFragment("caller", event.delta, event.startMs, event.endMs);
        return;
      case "session.output_transcript.delta":
        this.appendFragment("agent", event.delta, event.startMs, event.endMs);
        if (!this.ending) this.restartQuietTimer();
        return;
      case "session.delegation.created":
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
    const speech = isSpeech(audio);
    if (speech) this.speechEndsAt = this.playbackEndsAt;
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
    let decision: DeskDecision = null;
    try {
      decision = await this.deps.decide([...this.turns], this.setup.lookups);
    } catch (error) {
      // The caller can still hang up, and the time limit still ends the
      // call; the next thing Mili says asks again.
      this.log.warn(
        "[voice-agent] the call desk did not answer.",
        error instanceof Error ? error.message : error,
      );
    }
    let lookupCue: string | null = null;
    if (decision?.action === "lookup") {
      const key = JSON.stringify(decision.request);
      if (this.lookupsRun.has(key)) {
        decision = null;
      } else {
        this.lookupsRun.add(key);
        lookupCue = await this.runLookup(decision.request);
      }
    }
    this.deskBusy = false;
    if (this.finished || this.ending) return;
    if (lookupCue !== null) {
      // Commentary makes her speak; a delegation is answered on its own id.
      this.sendModel({
        content: lookupCue,
        delegation_id: delegationId,
        type: delegationId
          ? "session.thinking.append"
          : "session.commentary.append",
      });
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
  private async runLookup(request: VoiceLookupRequest): Promise<string> {
    const lookup = this.setup.lookup;
    const offered = this.setup.lookups.some((l) => l.name === request.name);
    if (!lookup || !offered) return VOICE_LOOKUP_FAILED_CUE;
    try {
      const text = await this.within(lookup(request), LOOKUP_TIMEOUT_MS);
      if (text === null) {
        this.log.warn(`[voice-agent] lookup ${request.name} timed out.`);
        return VOICE_LOOKUP_FAILED_CUE;
      }
      return voiceLookupResultCue(text);
    } catch (error) {
      // The name only: what was asked and what came back stay off the logs.
      this.log.warn(
        `[voice-agent] lookup ${request.name} failed (${
          error instanceof Error ? error.name : "error"
        }).`,
      );
      return VOICE_LOOKUP_FAILED_CUE;
    }
  }

  /** Let her last words finish playing (her speech, not the silence after), then hand the call back. */
  private moveOn(outcome: AgentOutcome): void {
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

  private sendModel(event: LiveClientEvent): void {
    try {
      this.model?.send(event);
    } catch (error) {
      this.log.warn(
        "[voice-agent] could not send to GPT-Live.",
        error instanceof Error ? error.message : error,
      );
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

  /** Report once, then close both sides. */
  async finish(outcome: AgentOutcome): Promise<void> {
    if (this.finished || !this.claims) return;
    this.finished = true;
    this.ending = true;
    this.clearTimers();
    this.closeModel();
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
    this.settle();
  }
}
