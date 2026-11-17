import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import type { DeskDecision } from "@/lib/comms/voice-agent/desk";
import type { LiveClientEvent } from "@/lib/comms/voice-agent/live";
import {
  VoiceAgentSession,
  type VoiceAgentReportBody,
  type VoiceAgentSessionDeps,
} from "@/lib/comms/voice-agent/session";
import { signStreamToken } from "@/lib/comms/voice-agent/token";
import {
  VOICE_AGENT_MAX_SECONDS,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";
import type { VoiceLookupDefinition } from "@/lib/domain/comms/callers/lookups";

// The shared pieces of the voice-agent tests: the stream token, both
// carriers' environment, and a session driven by scripted sockets and timers.

export const SECRET = "s".repeat(40);
export const NOW = new Date("2026-11-09T00:00:00Z");
export const ORIGIN = "https://royal.example";
export const quiet = { error: () => {}, info: () => {}, warn: () => {} };

export const keys = generateKeyPairSync("ed25519");
export const TELNYX_PUBLIC = (
  keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
)
  .subarray(12)
  .toString("base64");

export const ENV = {
  COMMS_AGENT_ENABLED: "true",
  COMMS_AGENT_SECRET: SECRET,
  COMMS_CALLS_ENABLED: "true",
  COMMS_PHONE_NUMBERS: "+61280001234=twilio=Office,+61290001234=telnyx=Office",
  COMMS_SMS_ENABLED: "true",
  COMMS_STAFF_FORWARD_NUMBER: "+61400000000",
  COMMS_WEBHOOK_ORIGIN: ORIGIN,
  TELNYX_API_KEY: "KEY",
  TELNYX_CONNECTION_ID: "conn",
  TELNYX_PUBLIC_KEY: TELNYX_PUBLIC,
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_API_KEY_SID: "SK00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "token",
};

export function token(
  provider: "twilio" | "telnyx",
  callControlId: string,
  overrides: Partial<{ expiresAt: number; maxSeconds: number }> = {},
) {
  return signStreamToken(
    {
      callControlId,
      callId: "call-1",
      expiresAt: Math.floor(NOW.getTime() / 1000) + 600,
      maxSeconds: VOICE_AGENT_MAX_SECONDS,
      provider,
      ...overrides,
    },
    SECRET,
  );
}

export type Decide = (
  turns: readonly VoiceAgentTurn[],
  lookups: readonly VoiceLookupDefinition[],
) => Promise<DeskDecision>;

export function harness(
  dialect: "twilio" | "telnyx" = "telnyx",
  urlToken?: string,
  decide: Decide = async () => null,
  prepare?: VoiceAgentSessionDeps["prepare"],
) {
  const carrierOut: string[] = [];
  const modelOut: LiveClientEvent[] = [];
  const reports: VoiceAgentReportBody[] = [];
  const asked: VoiceAgentTurn[][] = [];
  const offered: (readonly VoiceLookupDefinition[])[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const state = {
    carrierClosed: false,
    /** While true, every send to Live throws, as a dropped socket does. */
    failSends: false,
    modelClosed: false,
    opened: 0,
  };
  let clock = NOW.getTime();
  const session = new VoiceAgentSession({
    carrier: {
      close: () => {
        state.carrierClosed = true;
      },
      send: (text) => carrierOut.push(text),
    },
    clearTimer: (handle) => {
      (handle as { live: boolean }).live = false;
    },
    decide: async (turns, lookups) => {
      asked.push([...turns]);
      offered.push(lookups);
      return decide(turns, lookups);
    },
    dialect,
    log: quiet,
    now: () => clock,
    prepare,
    openModel: async () => {
      state.opened += 1;
      return {
        close: () => {
          state.modelClosed = true;
        },
        send: (event) => {
          if (state.failSends) throw new Error("socket closed");
          modelOut.push(event);
        },
      };
    },
    report: async (body) => {
      reports.push(body);
    },
    secret: SECRET,
    setTimer: (fn, ms) => {
      const timer = { fn, live: true, ms };
      timers.push(timer);
      return timer;
    },
    urlToken: urlToken ?? null,
    voice: "marin",
  });
  const fire = (ms: number) => {
    for (const timer of timers.filter((t) => t.live && t.ms === ms)) {
      timer.live = false;
      timer.fn();
    }
  };
  /** Fire the most recently set live timer, whatever its delay. */
  const fireLast = () => {
    const timer = timers.filter((t) => t.live).at(-1);
    if (!timer) return assert.fail("no timer is pending");
    timer.live = false;
    timer.fn();
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    asked,
    carrierOut,
    fire,
    fireLast,
    modelOut,
    offered,
    reports,
    session,
    state,
    tick,
    timers,
  };
}

export const telnyxStart = (callControlId = "v3:abc") =>
  JSON.stringify({
    event: "start",
    start: { call_control_id: callControlId },
    stream_id: "s-1",
  });

/** μ-law 0x00 is the loudest sample; 0xff and 0x7f are silence. */
export const SPEECH = 0x00;

export const callerMedia = JSON.stringify({
  event: "media",
  media: {
    payload: Buffer.alloc(160, 0xff).toString("base64"),
    track: "inbound",
  },
});

/** Start a Telnyx session and let GPT-Live report itself started. */
export async function started(
  decide?: Decide,
  prepare?: VoiceAgentSessionDeps["prepare"],
) {
  const h = harness("telnyx", token("telnyx", "v3:abc"), decide, prepare);
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  h.session.handleModelEvent({ type: "session.started" });
  return h;
}
