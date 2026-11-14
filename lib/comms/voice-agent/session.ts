import {
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
  VOICE_AGENT_WRAP_UP_SECONDS,
  voiceAgentInstructions,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";
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
//   carrier opens the socket → "start" frame → token checked → Live opened
//   → session started → Mili greets → μ-law audio both ways, transcripts kept
//   → after each thing she says (or a Live delegation) the desk is asked
//   → desk: end_call / transfer_to_team, caller hangs up, time, or a failure
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

export type VoiceAgentSessionDeps = {
  readonly dialect: CommsProviderName;
  /** Telnyx carries the token on the URL; Twilio in its "start" frame. */
  readonly urlToken: string | null;
  readonly secret: string;
  readonly voice: string;
  readonly carrier: TextSocket;
  /** Open the Live socket; its frames come back through `handleModelEvent`. */
  readonly openModel: () => Promise<LiveConnection>;
  /** The call desk: should the call move on, given what has been said? */
  readonly decide: (turns: readonly VoiceAgentTurn[]) => Promise<DeskDecision>;
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
export function voiceAgentLiveStart(voice: string): LiveClientEvent {
  return {
    session: {
      audio: {
        format: { rate: 8000, type: "audio/pcmu" },
        output: { voice },
      },
      delegation: { type: "client" },
      instructions: voiceAgentInstructions(),
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
    if (this.finished) {
      this.model.close();
      return;
    }
    this.sendModel(voiceAgentLiveStart(this.deps.voice));
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
        this.ready = true;
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
      decision = await this.deps.decide([...this.turns]);
    } catch (error) {
      // The caller can still hang up, and the time limit still ends the
      // call; the next thing Mili says asks again.
      this.log.warn(
        "[voice-agent] the call desk did not answer.",
        error instanceof Error ? error.message : error,
      );
    }
    this.deskBusy = false;
    if (this.finished || this.ending) return;
    if (delegationId) {
      this.sendModel({
        content: deskNote(decision),
        delegation_id: delegationId,
        type: "session.thinking.append",
      });
    }
    if (decision) {
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
