import type {
  Experimental_RealtimeClientEvent as RealtimeClientEvent,
  Experimental_RealtimeServerEvent as RealtimeServerEvent,
  Experimental_RealtimeSessionConfig as RealtimeSessionConfig,
} from "ai";

import {
  VOICE_AGENT_GREETING,
  VOICE_AGENT_TOOLS,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
  VOICE_AGENT_WRAP_UP_SECONDS,
  voiceAgentInstructions,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";
import type { AgentOutcome, CommsProviderName } from "@/lib/domain/ports/comms";

import {
  MODEL_SAMPLE_RATE,
  modelToPhone,
  phoneToModel,
  PHONE_SAMPLE_RATE,
} from "./audio";
import {
  carrierClearFrame,
  carrierMediaFrame,
  parseCarrierFrame,
} from "./frames";
import { verifyStreamToken, type StreamTokenClaims } from "./token";

// One phone call with Mili: the carrier's media stream on one side, the live
// model on AI Gateway on the other (stream-handler.ts wires the sockets).
//
//   carrier opens the socket → "start" frame → token checked → model opened
//   → session configured → Mili greets → audio both ways, transcripts kept
//   → end_call / transfer_to_team / caller hangs up / time / a failure
//   → outcome reported (the call router decides what the caller hears next)
//   → sockets closed
//
// Written against tiny socket and timer interfaces so every branch can be
// driven by a test. The session never decides anything about the call
// itself: it reports an outcome, and lib/domain does the rest.

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
  /** Open the model socket; its messages come back through `handleModelEvent`. */
  readonly openModel: () => Promise<{
    send(event: RealtimeClientEvent): void;
    close(): void;
  }>;
  readonly report: (body: VoiceAgentReportBody) => Promise<void>;
  readonly log?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

/** Without a "start" frame by then, the socket is not a call. */
export const START_TIMEOUT_MS = 10_000;
/** The model must be ready by then, or the caller goes to a person. */
export const MODEL_STARTUP_TIMEOUT_MS = 15_000;
/** A 20 ms frame of phone audio. */
const FRAME_BYTES = (PHONE_SAMPLE_RATE / 1000) * 20;
/** After Mili's last word, before hanging up or transferring. */
const PLAYBACK_TAIL_MS = 600;
const MAX_PLAYBACK_WAIT_MS = 15_000;

export function voiceAgentSessionConfig(voice: string): RealtimeSessionConfig {
  return {
    inputAudioFormat: { rate: MODEL_SAMPLE_RATE, type: "audio/pcm" },
    inputAudioTranscription: { language: "en" },
    instructions: voiceAgentInstructions(),
    outputAudioFormat: { rate: MODEL_SAMPLE_RATE, type: "audio/pcm" },
    outputAudioTranscription: {},
    outputModalities: ["audio"],
    providerOptions: { gateway: { tags: ["voice-agent", "mili"] } },
    tools: VOICE_AGENT_TOOLS.map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: JSON.parse(JSON.stringify(tool.parameters)),
      type: tool.type,
    })),
    turnDetection: {
      prefixPaddingMs: 300,
      silenceDurationMs: 600,
      type: "server-vad",
    },
    voice,
  };
}

export class VoiceAgentSession {
  private readonly deps: VoiceAgentSessionDeps;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private claims: StreamTokenClaims | null = null;
  private streamId: string | null = null;
  private model: Awaited<
    ReturnType<VoiceAgentSessionDeps["openModel"]>
  > | null = null;
  private ready = false;
  private finished = false;
  private ending = false;
  private readonly timers = new Set<unknown>();
  private readonly inCarry = { last: 0 };
  private readonly outPending = { bytes: Buffer.alloc(0) };
  private playbackEndsAt = 0;

  /** In the order spoken. */
  readonly turns: VoiceAgentTurn[] = [];
  /** Settles once the session has reported and closed, or was turned away. */
  readonly done: Promise<void>;
  private settle: () => void = () => {};
  private usesFragments = false;
  private readonly agentDrafts = new Map<string, string>();

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
            options: { instructions: VOICE_AGENT_WRAP_UP_INSTRUCTION },
            type: "response-create",
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
        this.log.warn("[voice-agent] the model did not start in time.");
        void this.finish("failed");
      }
    });
    try {
      this.model = await this.deps.openModel();
    } catch (error) {
      this.log.error(
        "[voice-agent] could not open the model session.",
        error instanceof Error ? error.message : error,
      );
      void this.finish("failed");
      return;
    }
    if (this.finished) {
      this.model.close();
      return;
    }
    this.sendModel({
      config: voiceAgentSessionConfig(this.deps.voice),
      type: "session-update",
    });
  }

  private forwardCallerAudio(payload: string): void {
    if (!this.ready || this.ending || !this.model) return;
    const pcm = phoneToModel(Buffer.from(payload, "base64"), this.inCarry);
    this.sendModel({
      audio: pcm.toString("base64"),
      type: "input-audio-append",
    });
  }

  // ── Model ────────────────────────────────────────────────────────────

  /** The model socket opened, once `openModel` resolves. */
  handleModelEvent(event: RealtimeServerEvent): void {
    if (this.finished) return;
    switch (event.type) {
      case "session-created":
      case "session-updated":
      case "session-started":
        if (!this.ready && this.model) {
          this.ready = true;
          this.greet();
        }
        return;
      case "audio-delta":
      case "audio-chunk":
        this.playToCaller(event.delta);
        return;
      case "speech-started":
        // The caller talked over Mili: stop playing what is queued.
        this.deps.carrier.send(
          carrierClearFrame(this.deps.dialect, this.streamId),
        );
        this.playbackEndsAt = this.now();
        this.outPending.bytes = Buffer.alloc(0);
        return;
      case "transcript-fragment":
        this.usesFragments = true;
        this.appendTurn(
          event.speaker === "user" ? "caller" : "agent",
          event.delta,
          true,
        );
        return;
      case "input-transcription-completed":
        if (!this.usesFragments) this.appendTurn("caller", event.transcript);
        return;
      case "audio-transcript-delta":
        this.agentDrafts.set(
          event.itemId,
          (this.agentDrafts.get(event.itemId) ?? "") + event.delta,
        );
        return;
      case "audio-transcript-done": {
        const text = event.transcript ?? this.agentDrafts.get(event.itemId);
        this.agentDrafts.delete(event.itemId);
        if (!this.usesFragments && text) this.appendTurn("agent", text);
        return;
      }
      case "function-call-arguments-done":
        this.handleToolCall(event.callId, event.name);
        return;
      case "error":
        this.log.warn(
          `[voice-agent] the model reported an error (${event.code ?? "no code"}).`,
        );
        if (!this.ready) void this.finish("failed");
        return;
      case "session-closed":
        void this.finish(this.turns.length > 0 ? "completed" : "failed");
        return;
      default:
        return;
    }
  }

  /** The model socket closed. Mid-conversation that is a failure: the caller is still there. */
  handleModelClosed(): void {
    if (this.finished || this.ending) return;
    this.log.warn("[voice-agent] the model session closed unexpectedly.");
    void this.finish("failed");
  }

  private greet(): void {
    // Continuous Live sessions may refuse an explicit response request; the
    // caller's first words then start the conversation instead.
    this.sendModel({
      options: {
        instructions: `Greet the caller now, in these words: "${VOICE_AGENT_GREETING}"`,
      },
      type: "response-create",
    });
  }

  private playToCaller(base64Pcm: string): void {
    const muLaw = modelToPhone(
      Buffer.from(base64Pcm, "base64"),
      this.outPending,
    );
    const now = this.now();
    for (let offset = 0; offset < muLaw.length; offset += FRAME_BYTES) {
      const frame = muLaw.subarray(offset, offset + FRAME_BYTES);
      this.deps.carrier.send(
        carrierMediaFrame(
          this.deps.dialect,
          this.streamId,
          frame.toString("base64"),
        ),
      );
    }
    const ms = (muLaw.length / PHONE_SAMPLE_RATE) * 1000;
    this.playbackEndsAt = Math.max(this.playbackEndsAt, now) + ms;
  }

  private appendTurn(
    speaker: VoiceAgentTurn["speaker"],
    text: string,
    fragment = false,
  ): void {
    if (!text.trim() && !fragment) return;
    const last = this.turns.at(-1);
    if (fragment && last && last.speaker === speaker) {
      this.turns[this.turns.length - 1] = {
        speaker,
        text: `${last.text}${text}`,
      };
      return;
    }
    if (text.trim()) this.turns.push({ speaker, text: text.trim() });
  }

  private handleToolCall(callId: string, name: string): void {
    const outcome: AgentOutcome | null =
      name === "end_call"
        ? "completed"
        : name === "transfer_to_team"
          ? "transfer"
          : null;
    this.sendModel({
      item: {
        callId,
        name,
        output: JSON.stringify(
          outcome
            ? { ok: true }
            : { error: `There is no tool called ${name}.` },
        ),
        type: "function-call-output",
      },
      type: "conversation-item-create",
    });
    if (!outcome) {
      this.sendModel({ type: "response-create" });
      return;
    }
    // Let her last words finish playing before the line goes quiet.
    this.ending = true;
    const wait = Math.min(
      MAX_PLAYBACK_WAIT_MS,
      Math.max(0, this.playbackEndsAt - this.now()) + PLAYBACK_TAIL_MS,
    );
    this.after(wait, () => void this.finish(outcome));
  }

  // ── Ending ───────────────────────────────────────────────────────────

  private sendModel(event: RealtimeClientEvent): void {
    try {
      this.model?.send(event);
    } catch (error) {
      this.log.warn(
        "[voice-agent] could not send to the model.",
        error instanceof Error ? error.message : error,
      );
    }
  }

  private after(ms: number, fn: () => void): void {
    const handle = this.setTimer(() => {
      this.timers.delete(handle);
      fn();
    }, ms);
    this.timers.add(handle);
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.clearTimer(handle);
    this.timers.clear();
  }

  /** Not a call we will serve: close without reporting anything. */
  private abandon(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.log.warn(`[voice-agent] closing a stream: ${reason}.`);
    this.model?.close();
    this.deps.carrier.close();
    this.settle();
  }

  /** Report once, then close both sides. */
  async finish(outcome: AgentOutcome): Promise<void> {
    if (this.finished || !this.claims) return;
    this.finished = true;
    this.ending = true;
    this.clearTimers();
    this.model?.close();
    const claims = this.claims;
    try {
      await this.deps.report({
        callControlId: claims.callControlId,
        callId: claims.callId,
        outcome,
        provider: claims.provider,
        turns: [...this.turns],
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
