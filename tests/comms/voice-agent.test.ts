import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { twilioSignature } from "@/lib/comms/providers/twilio/signature";
import { encodeClientState } from "@/lib/comms/providers/telnyx/client-state";
import { handleCommsWebhook } from "@/lib/comms/webhook-handler";
import type { DeskDecision } from "@/lib/comms/voice-agent/desk";
import {
  carrierMediaFrame,
  parseCarrierFrame,
} from "@/lib/comms/voice-agent/frames";
import {
  mintLiveClientSecret,
  parseLiveServerEvent,
  type LiveClientEvent,
} from "@/lib/comms/voice-agent/live";
import {
  isSpeech,
  START_TIMEOUT_MS,
  TURN_QUIET_MS,
  VoiceAgentSession,
  type VoiceAgentReportBody,
} from "@/lib/comms/voice-agent/session";
import { VOICE_AGENT_MODEL } from "@/lib/comms/voice-agent/settings";
import { voiceAgentWarmUrl } from "@/lib/comms/voice-agent/stream";
import {
  handleVoiceAgentStream,
  recordVoiceAgentOutcome,
} from "@/lib/comms/voice-agent/stream-handler";
import {
  signStreamToken,
  verifyStreamToken,
} from "@/lib/comms/voice-agent/token";
import { PROMPTS } from "@/lib/domain/comms/calls/flow";
import {
  formatVoiceAgentTranscript,
  VOICE_AGENT_GREETING,
  VOICE_AGENT_GREETING_CUE,
  VOICE_AGENT_MAX_SECONDS,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";

import { recordingDb } from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// Mili, the voice agent: the stream token, both carriers' stream frames, the
// GPT-Live socket's events and credential, one conversation driven end to
// end with the call desk deciding when it ends, and the handover back to the
// call router when she is done.

const SECRET = "s".repeat(40);
const NOW = new Date("2026-11-09T00:00:00Z");
const ORIGIN = "https://royal.example";
const quiet = { error: () => {}, info: () => {}, warn: () => {} };

const keys = generateKeyPairSync("ed25519");
const TELNYX_PUBLIC = (
  keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
)
  .subarray(12)
  .toString("base64");

const ENV = {
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

function token(
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

// ── Token ────────────────────────────────────────────────────────────

test("a stream token opens one call, for one carrier, until it expires", () => {
  const good = token("telnyx", "v3:abc");
  assert.deepEqual(verifyStreamToken(good, SECRET, NOW), {
    callControlId: "v3:abc",
    callId: "call-1",
    expiresAt: Math.floor(NOW.getTime() / 1000) + 600,
    maxSeconds: VOICE_AGENT_MAX_SECONDS,
    provider: "telnyx",
  });
  assert.equal(verifyStreamToken(good, "x".repeat(40), NOW), null);
  assert.equal(verifyStreamToken(`${good}x`, SECRET, NOW), null);
  const [body, mac] = good.split(".");
  const swapped = Buffer.from(
    Buffer.from(body, "base64url").toString().replace("v3:abc", "v3:xyz"),
  ).toString("base64url");
  assert.equal(verifyStreamToken(`${swapped}.${mac}`, SECRET, NOW), null);
  assert.equal(
    verifyStreamToken(token("telnyx", "v3:abc", { expiresAt: 1 }), SECRET, NOW),
    null,
  );
  assert.equal(verifyStreamToken(null, SECRET, NOW), null);
});

// ── Frames ───────────────────────────────────────────────────────────

test("each carrier's start frame names its call; Twilio's carries the token", () => {
  assert.deepEqual(
    parseCarrierFrame(
      "twilio",
      JSON.stringify({
        event: "start",
        start: {
          callSid: "CA1",
          customParameters: { token: "t" },
          streamSid: "MZ1",
        },
        streamSid: "MZ1",
      }),
    ),
    { kind: "start", providerCallId: "CA1", streamId: "MZ1", token: "t" },
  );
  assert.deepEqual(
    parseCarrierFrame(
      "telnyx",
      JSON.stringify({
        event: "start",
        start: { call_control_id: "v3:abc" },
        stream_id: "s-1",
      }),
    ),
    { kind: "start", providerCallId: "v3:abc", streamId: "s-1", token: null },
  );
});

test("only the caller's audio reaches Mili", () => {
  const media = (track: string) =>
    parseCarrierFrame(
      "telnyx",
      JSON.stringify({ event: "media", media: { payload: "AAAA", track } }),
    );
  assert.deepEqual(media("inbound"), { kind: "media", payload: "AAAA" });
  assert.deepEqual(media("outbound"), { kind: "other" });
  assert.deepEqual(parseCarrierFrame("twilio", "not json"), { kind: "other" });
});

test("audio goes back in each carrier's own shape", () => {
  assert.deepEqual(JSON.parse(carrierMediaFrame("twilio", "MZ1", "AA")), {
    event: "media",
    media: { payload: "AA" },
    streamSid: "MZ1",
  });
  assert.deepEqual(JSON.parse(carrierMediaFrame("telnyx", "s", "AA")), {
    event: "media",
    media: { payload: "AA" },
  });
});

// ── GPT-Live socket ──────────────────────────────────────────────────

test("GPT-Live frames are narrowed to what the relay uses", () => {
  const parse = (event: unknown) => parseLiveServerEvent(JSON.stringify(event));
  assert.deepEqual(parse({ session: { id: "s" }, type: "session.started" }), {
    type: "session.started",
  });
  assert.deepEqual(
    parse({ delta: "AAAA", type: "session.output_audio.delta" }),
    { delta: "AAAA", type: "session.output_audio.delta" },
  );
  assert.deepEqual(
    parse({
      delta: " Hi",
      end_ms: 7800,
      start_ms: 7600,
      type: "session.input_transcript.delta",
    }),
    {
      delta: " Hi",
      endMs: 7800,
      startMs: 7600,
      type: "session.input_transcript.delta",
    },
  );
  // Captured from the live service: a delegation names itself, not a task.
  assert.deepEqual(
    parse({
      delegation: { id: "item_1", target: "client", type: "delegation" },
      event_id: "event_1",
      offset_ms: 11000,
      type: "session.delegation.created",
    }),
    { delegationId: "item_1", type: "session.delegation.created" },
  );
  assert.deepEqual(
    parse({
      error: { code: "invalid_request_error", message: "Unsupported" },
      type: "error",
    }),
    { code: "invalid_request_error", message: "Unsupported", type: "error" },
  );
  assert.deepEqual(parse({ type: "session.usage.updated" }), { type: "other" });
  assert.deepEqual(parseLiveServerEvent("not json"), { type: "other" });
});

test("a GPT-Live secret is minted with the server's Gateway key, else its OIDC token", async () => {
  const seen: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
      url: String(url),
    });
    return Response.json({ expiresAt: 1, token: "live-secret" });
  }) as typeof fetch;

  assert.equal(
    await mintLiveClientSecret({
      env: { AI_GATEWAY_API_KEY: "gw-key" },
      fetch: fetchImpl,
      oidcToken: async () => assert.fail("the key comes first"),
    }),
    "live-secret",
  );
  assert.equal(
    seen[0].url,
    "https://ai-gateway.vercel.sh/v1/realtime/client-secrets",
  );
  assert.deepEqual(seen[0].body, {
    model: VOICE_AGENT_MODEL,
    routeKind: "live",
  });
  assert.equal(seen[0].headers.Authorization, "Bearer gw-key");
  assert.equal(seen[0].headers["ai-gateway-auth-method"], "api-key");

  await mintLiveClientSecret({
    env: {},
    fetch: fetchImpl,
    oidcToken: async () => "oidc-token",
  });
  assert.equal(seen[1].headers.Authorization, "Bearer oidc-token");
  assert.equal(seen[1].headers["ai-gateway-auth-method"], "oidc");

  await assert.rejects(
    mintLiveClientSecret({
      env: { AI_GATEWAY_API_KEY: "k" },
      fetch: (async () => new Response("no", { status: 403 })) as typeof fetch,
    }),
    /HTTP 403/,
  );
});

test("Mili runs on GPT-Live, never a realtime model the Gateway refuses", () => {
  assert.equal(VOICE_AGENT_MODEL, "openai/gpt-live-1");
});

// ── Session ──────────────────────────────────────────────────────────

type Decide = (turns: readonly VoiceAgentTurn[]) => Promise<DeskDecision>;

function harness(
  dialect: "twilio" | "telnyx" = "telnyx",
  urlToken?: string,
  decide: Decide = async () => null,
) {
  const carrierOut: string[] = [];
  const modelOut: LiveClientEvent[] = [];
  const reports: VoiceAgentReportBody[] = [];
  const asked: VoiceAgentTurn[][] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const state = { carrierClosed: false, modelClosed: false, opened: 0 };
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
    decide: async (turns) => {
      asked.push([...turns]);
      return decide(turns);
    },
    dialect,
    log: quiet,
    now: () => clock,
    openModel: async () => {
      state.opened += 1;
      return {
        close: () => {
          state.modelClosed = true;
        },
        send: (event) => modelOut.push(event),
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
    reports,
    session,
    state,
    tick,
    timers,
  };
}

const telnyxStart = (callControlId = "v3:abc") =>
  JSON.stringify({
    event: "start",
    start: { call_control_id: callControlId },
    stream_id: "s-1",
  });

/** μ-law 0x00 is the loudest sample; 0xff and 0x7f are silence. */
const SPEECH = 0x00;

const callerMedia = JSON.stringify({
  event: "media",
  media: {
    payload: Buffer.alloc(160, 0xff).toString("base64"),
    track: "inbound",
  },
});

/** Start a Telnyx session and let GPT-Live report itself started. */
async function started(decide?: Decide) {
  const h = harness("telnyx", token("telnyx", "v3:abc"), decide);
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  h.session.handleModelEvent({ type: "session.started" });
  return h;
}

test("a stream without a valid token never reaches the model", async () => {
  for (const [urlToken, start] of [
    [undefined, telnyxStart()],
    [token("telnyx", "v3:other"), telnyxStart()],
    [token("twilio", "v3:abc"), telnyxStart()],
  ] as const) {
    const h = harness("telnyx", urlToken);
    h.session.handleCarrierText(start);
    await h.session.done;
    assert.equal(h.state.opened, 0);
    assert.equal(h.state.carrierClosed, true);
    assert.deepEqual(h.reports, []);
  }
  const silent = harness("telnyx", token("telnyx", "v3:abc"));
  silent.fire(START_TIMEOUT_MS);
  await silent.session.done;
  assert.equal(silent.state.carrierClosed, true);
});

test("Live starts as Mili, in phone μ-law, with client delegation", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  assert.equal(h.state.opened, 1);
  const start = h.modelOut[0];
  assert.equal(start.type, "session.start");
  if (start.type !== "session.start") return;
  assert.equal(start.session.model, "openai/gpt-live-1");
  assert.deepEqual(start.session.audio, {
    format: { rate: 8000, type: "audio/pcmu" },
    output: { voice: "marin" },
  });
  assert.deepEqual(start.session.delegation, { type: "client" });
  assert.equal(start.session.store, false);
  assert.ok(
    start.session.instructions.includes(VOICE_AGENT_GREETING),
    "she opens the call herself, in the agreed words",
  );
});

test("once Live has started Mili is cued to greet first, once, before the caller says anything", async () => {
  const h = await started();
  const cue = {
    content: VOICE_AGENT_GREETING_CUE,
    delegation_id: null,
    type: "session.commentary.append",
  } as const;
  // Straight after session.start: she does not wait for caller audio.
  assert.equal(h.modelOut.length, 2);
  assert.deepEqual(h.modelOut[1], cue);
  assert.ok(VOICE_AGENT_GREETING_CUE.includes(VOICE_AGENT_GREETING));
  // A repeated session.started does not make her greet twice.
  h.session.handleModelEvent({ type: "session.started" });
  assert.equal(h.modelOut.filter((e) => e.type === cue.type).length, 1);
});

test("one conversation: audio passes through, transcripts kept, the desk ends it after her goodbye", async () => {
  let goodbyeSaid = false;
  const h = await started(async () => (goodbyeSaid ? { action: "end" } : null));

  // Caller audio goes to Live untouched: both sides speak 8 kHz μ-law.
  h.session.handleCarrierText(callerMedia);
  assert.deepEqual(h.modelOut.at(-1), {
    audio: Buffer.alloc(160, 0xff).toString("base64"),
    type: "session.input_audio.append",
  });

  // 40 ms of her audio → two 20 ms phone frames.
  h.session.handleModelEvent({
    delta: Buffer.alloc(320, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  const frames = h.carrierOut.map((text) => JSON.parse(text));
  assert.equal(frames.length, 2);
  assert.equal(Buffer.from(frames[0].media.payload, "base64").length, 160);

  // Transcript deltas carry session time, as Live sends them.
  for (const [delta, at] of [
    [" Hi,", 1000],
    [" you're speaking with Mili.", 1200],
  ] as const) {
    h.session.handleModelEvent({
      delta,
      endMs: at + 200,
      startMs: at,
      type: "session.output_transcript.delta",
    });
  }
  for (const [delta, at] of [
    [" I'd like", 4000],
    [" a knockdown rebuild.", 4200],
  ] as const) {
    h.session.handleModelEvent({
      delta,
      endMs: at + 200,
      startMs: at,
      type: "session.input_transcript.delta",
    });
  }

  // Her turn ends (no audio for a moment): the desk is asked, says carry on.
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.equal(h.asked.length, 1);
  assert.deepEqual(h.reports, []);

  // She says goodbye; the desk now ends the call, once her words have played.
  goodbyeSaid = true;
  h.session.handleModelEvent({
    delta: Buffer.alloc(160, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.session.handleModelEvent({
    delta: " Goodbye.",
    endMs: 9200,
    startMs: 9000,
    type: "session.output_transcript.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.reports, [], "waits for her goodbye to finish playing");
  h.fireLast();
  await h.session.done;
  assert.deepEqual(h.reports, [
    {
      callControlId: "v3:abc",
      callId: "call-1",
      outcome: "completed",
      provider: "telnyx",
      turns: [
        { speaker: "agent", text: "Hi, you're speaking with Mili." },
        { speaker: "caller", text: "I'd like a knockdown rebuild." },
        { speaker: "agent", text: "Goodbye." },
      ],
    },
  ]);
  assert.deepEqual(h.modelOut.at(-1), { type: "session.close" });
  assert.equal(h.state.modelClosed, true);
  assert.equal(h.state.carrierClosed, true);
});

test("a Live delegation asks the desk at once and tells Mili what it did", async () => {
  const h = await started(async () => ({
    action: "transfer",
    reason: "asked for a person",
  }));
  h.session.handleModelEvent({
    delegationId: "item_1",
    type: "session.delegation.created",
  });
  await h.tick();
  assert.deepEqual(h.modelOut.at(-1), {
    content: "The call desk is putting the caller through to the team now.",
    delegation_id: "item_1",
    type: "session.thinking.append",
  });
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "transfer");
});

test("audio still arriving after the desk decides is played before the line moves on", async () => {
  const h = await started(async () => ({ action: "end" }));
  h.session.handleModelEvent({
    delegationId: "item_1",
    type: "session.delegation.created",
  });
  await h.tick();
  // A second more of her goodbye arrives after the decision.
  h.session.handleModelEvent({
    delta: Buffer.alloc(8_000, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fireLast();
  assert.equal(h.reports.length, 0, "a second of audio is still playing");
  h.advance(2_000);
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("a desk that fails never ends the call by itself", async () => {
  const h = await started(async () => {
    throw new Error("gateway down");
  });
  h.session.handleModelEvent({
    delta: Buffer.alloc(160).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.reports, []);
  h.session.handleCarrierText(callerMedia);
  assert.equal(h.modelOut.at(-1)?.type, "session.input_audio.append");
});

test("her line hiss is not speech; her voice is", () => {
  assert.equal(isSpeech(Buffer.alloc(160, 0xff)), false, "μ-law silence");
  assert.equal(isSpeech(Buffer.alloc(160, 0x7f)), false, "the other zero");
  assert.equal(isSpeech(Buffer.alloc(160, SPEECH)), true);
  assert.equal(isSpeech(Buffer.alloc(0)), false);
});

test("GPT-Live's continuous silence never ends her turn or asks the desk", async () => {
  const h = await started(async () => ({ action: "end" }));
  // Live streams audio the whole time; silence restarts nothing.
  for (let i = 0; i < 5; i += 1) {
    h.session.handleModelEvent({
      delta: Buffer.alloc(160, 0xff).toString("base64"),
      type: "session.output_audio.delta",
    });
  }
  assert.equal(
    h.timers.filter((t) => t.live && t.ms === TURN_QUIET_MS).length,
    0,
  );
  assert.equal(h.asked.length, 0);
});

test("overlapping speakers join up by time, not by who spoke last", async () => {
  const h = await started();
  const say = (speaker: "caller" | "agent", delta: string, startMs: number) =>
    h.session.handleModelEvent({
      delta,
      endMs: startMs + 200,
      startMs,
      type:
        speaker === "caller"
          ? "session.input_transcript.delta"
          : "session.output_transcript.delta",
    });
  // As captured from a live session: she backchannels while the caller talks.
  say("agent", " Hi, you're speaking", 1000);
  say("agent", " with Mili.", 1200);
  say("caller", " My name", 3000);
  say("agent", " Okay.", 3100);
  say("caller", " is Sam,", 3200);
  say("caller", " building in Oran Park.", 3400);
  say("agent", " Thanks, Sam.", 6000);
  assert.deepEqual(h.session.turns, [
    { speaker: "agent", text: "Hi, you're speaking with Mili." },
    { speaker: "caller", text: "My name is Sam, building in Oran Park." },
    { speaker: "agent", text: "Okay." },
    { speaker: "agent", text: "Thanks, Sam." },
  ]);
});

test("GPT-Live failing to start sends the caller to a person", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  // Caller audio before the session is ready is dropped.
  h.session.handleCarrierText(callerMedia);
  assert.equal(h.modelOut.length, 1);
  h.session.handleModelEvent({
    code: "invalid_model",
    message: "nope",
    type: "error",
  });
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "failed");
});

test("GPT-Live dropping mid-call hands back", async () => {
  const h = await started();
  h.session.handleModelClosed();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "failed");
});

test("near the time limit Mili is asked to wrap up; at it the call ends", async () => {
  const h = await started();
  h.fire((VOICE_AGENT_MAX_SECONDS - 45) * 1000);
  assert.deepEqual(h.modelOut.at(-1), {
    content: VOICE_AGENT_WRAP_UP_INSTRUCTION,
    delegation_id: null,
    type: "session.instructions.append",
  });
  h.fire(VOICE_AGENT_MAX_SECONDS * 1000);
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("the caller hanging up ends the session once, with what was said", async () => {
  const h = harness("twilio");
  h.session.handleCarrierText(
    JSON.stringify({
      event: "start",
      start: {
        callSid: "CA1",
        customParameters: { token: token("twilio", "CA1") },
        streamSid: "MZ1",
      },
    }),
  );
  await h.tick();
  h.session.handleModelEvent({ type: "session.started" });
  h.session.handleCarrierText(JSON.stringify({ event: "stop" }));
  h.session.handleCarrierClosed();
  await h.session.done;
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].provider, "twilio");
});

test("the transcript is one line per turn, capped", () => {
  assert.equal(
    formatVoiceAgentTranscript([
      { speaker: "agent", text: " Hi  there " },
      { speaker: "caller", text: "" },
      { speaker: "caller", text: "Hello" },
    ]),
    "Mili: Hi there\nCaller: Hello",
  );
  assert.equal(formatVoiceAgentTranscript([]), null);
  const long = formatVoiceAgentTranscript([
    { speaker: "caller", text: "x".repeat(30_000) },
  ]);
  assert.ok(long && long.length <= 20_000);
});

// ── The route ─────────────────────────────────────────────────────────

test("the stream route is closed unless Mili is on, and only upgrades a WebSocket", async () => {
  const off = await handleVoiceAgentStream(
    new Request(`${ORIGIN}/api/comms/voice-agent/telnyx`),
    { provider: "telnyx" },
    {
      db: recordingDb({}).transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv({ ...ENV, COMMS_AGENT_ENABLED: "" }),
      upgrade: async () => assert.fail("never upgraded"),
    },
  );
  assert.equal(off.status, 404);
  const on = {
    db: recordingDb({}).transactionalDb,
    log: quiet,
    runtime: commsRuntimeFromEnv(ENV),
    upgrade: async () => assert.fail("never upgraded"),
  };
  assert.equal(
    (
      await handleVoiceAgentStream(
        new Request(`${ORIGIN}/api/comms/voice-agent/plivo`, {
          headers: { upgrade: "websocket" },
        }),
        { provider: "plivo" },
        on,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handleVoiceAgentStream(
        new Request(`${ORIGIN}/api/comms/voice-agent/telnyx`),
        { provider: "telnyx" },
        on,
      )
    ).status,
    426,
  );
  // A runtime that cannot upgrade (next dev) is a 503, so the carrier
  // reports the stream failed and the caller goes to a person.
  assert.equal(
    (
      await handleVoiceAgentStream(
        new Request(`${ORIGIN}/api/comms/voice-agent/telnyx`, {
          headers: { upgrade: "websocket" },
        }),
        { provider: "telnyx" },
        {
          ...on,
          upgrade: async () => {
            throw new Error("not available");
          },
        },
      )
    ).status,
    503,
  );
});

test("her route is only warmed when Mili is on", () => {
  assert.equal(
    voiceAgentWarmUrl(commsRuntimeFromEnv(ENV).config, "telnyx"),
    "https://royal.example/api/comms/voice-agent/telnyx",
  );
  assert.equal(
    voiceAgentWarmUrl(
      commsRuntimeFromEnv({ ...ENV, COMMS_AGENT_ENABLED: "" }).config,
      "telnyx",
    ),
    null,
  );
});

test("the route's function outlives the longest conversation", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(
    `${REPO_ROOT}/app/api/comms/voice-agent/[provider]/route.ts`,
    "utf8",
  );
  const maxDuration = Number(/maxDuration = (\d+)/.exec(route)?.[1]);
  assert.ok(maxDuration >= VOICE_AGENT_MAX_SECONDS + 20, String(maxDuration));
});

// ── Carriers, end to end ──────────────────────────────────────────────

function twilioRequest(
  event: string,
  form: Record<string, string>,
  query = "",
) {
  const url = `${ORIGIN}/api/comms/twilio/${event}${query}`;
  const params = new URLSearchParams(form);
  return new Request(url, {
    body: params.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioSignature("token", url, params),
    },
    method: "POST",
  });
}

function telnyxRequest(event: string, body: unknown) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request(`${ORIGIN}/api/comms/telnyx/${event}`, {
    body: raw,
    headers: {
      "content-type": "application/json",
      "telnyx-signature-ed25519": sign(
        null,
        Buffer.from(`${timestamp}|${raw}`),
        keys.privateKey,
      ).toString("base64"),
      "telnyx-timestamp": timestamp,
    },
    method: "POST",
  });
}

function recordingFetch() {
  const requests: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ body: String(init.body ?? ""), url: String(url) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const AGENT_CALL = {
  answeredAt: NOW,
  answeredBy: "AGENT",
  businessNumber: "+61290001234",
  connectedAt: NOW,
  customerNumber: "+61412345678",
  direction: "INBOUND",
  durationSeconds: null,
  flowStep: "AGENT",
  id: "call-1",
  leadId: 7,
  recordingConsent: "DECLARED",
  staffTarget: null,
  staffUserId: null,
  startedAt: NOW,
  status: "IN_PROGRESS",
};

test("Twilio: an inbound call hears the declaration, then streams to Mili", async () => {
  const runtime = commsRuntimeFromEnv(ENV);
  const warmed: string[] = [];
  const response = await handleCommsWebhook(
    twilioRequest("voice-inbound", {
      CallSid: "CA1",
      From: "+61412345678",
      To: "+61280001234",
    }),
    { event: "voice-inbound", provider: "twilio" },
    {
      allow: () => true,
      db: recordingDb({
        "call.create": { id: "call-1" },
        "call.findUnique": null,
        "lead.findMany": [],
      }).transactionalDb,
      log: quiet,
      runtime,
      warmVoiceAgent: (url) => warmed.push(url),
    },
  );
  const xml = await response.text();
  assert.deepEqual(
    warmed,
    ["https://royal.example/api/comms/voice-agent/twilio"],
    "her route is warmed while the declaration plays",
  );
  assert.ok(xml.includes(PROMPTS.recordingDeclaration.replace(/'/g, "&apos;")));
  assert.doesNotMatch(xml, /<Client/, "no browser rings");
  assert.match(
    xml,
    /<Connect action="https:\/\/royal\.example\/api\/comms\/twilio\/voice-agent-done\?callId=call-1" method="POST"><Stream url="wss:\/\/royal\.example\/api\/comms\/voice-agent\/twilio"/,
  );
  assert.match(xml, /voice-agent-stream\?callId=call-1&amp;record=1/);
  const sent = /<Parameter name="token" value="([^"]+)"\/>/.exec(xml)?.[1];
  assert.equal(verifyStreamToken(sent, SECRET)?.callControlId, "CA1");
  assert.equal(verifyStreamToken(sent, SECRET)?.provider, "twilio");
});

test("Twilio: the conversation is recorded once audio flows", async () => {
  const { fetchImpl, requests } = recordingFetch();
  await handleCommsWebhook(
    twilioRequest(
      "voice-agent-stream",
      { CallSid: "CA1", StreamEvent: "stream-started", StreamSid: "MZ1" },
      "?callId=call-1&record=1",
    ),
    { event: "voice-agent-stream", provider: "twilio" },
    {
      allow: () => true,
      db: recordingDb({ "commsWebhookEvent.findUnique": null }).transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
    },
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/Calls\/CA1\/Recordings\.json$/);
  const form = new URLSearchParams(requests[0].body);
  assert.equal(form.get("RecordingChannels"), "dual");
  assert.match(form.get("RecordingStatusCallback") ?? "", /kind=call/);
});

test("Twilio: a stream that ends without Mili moving the call on rings the mobile", async () => {
  const response = await handleCommsWebhook(
    twilioRequest("voice-agent-done", { CallSid: "CA1" }, "?callId=call-1"),
    { event: "voice-agent-done", provider: "twilio" },
    {
      allow: () => true,
      db: recordingDb({
        "call.findUnique": { ...AGENT_CALL, provider: "TWILIO" },
      }).transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV),
    },
  );
  const xml = await response.text();
  assert.match(xml, /<Number [^>]*>\+61400000000<\/Number>/);
  assert.match(xml, /assistant isn&apos;t available/);
});

test("Telnyx: after the declaration, the call is recorded and streamed to Mili", async () => {
  const { fetchImpl, requests } = recordingFetch();
  const warmed: string[] = [];
  await handleCommsWebhook(
    telnyxRequest("voice", {
      data: {
        event_type: "call.speak.ended",
        id: "evt-speak",
        payload: {
          call_control_id: "v3:abc",
          client_state: encodeClientState({
            c: "call-1",
            n: [
              {
                maxSeconds: VOICE_AGENT_MAX_SECONDS,
                op: "connectAgent",
                record: true,
              },
            ],
            r: "a",
          }),
        },
      },
    }),
    { event: "voice", provider: "telnyx" },
    {
      allow: () => true,
      db: recordingDb({ "commsWebhookEvent.findUnique": null }).transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
      warmVoiceAgent: (url) => warmed.push(url),
    },
  );
  assert.deepEqual(
    requests.map((request) => request.url.replace(/^.*\/actions\//, "")),
    ["record_start", "streaming_start"],
  );
  assert.deepEqual(warmed, [], "warmed when decided, not as the stream opens");
  const body = JSON.parse(requests[1].body) as Record<string, string>;
  assert.equal(body.stream_bidirectional_codec, "PCMU");
  const url = new URL(body.stream_url);
  assert.equal(
    url.origin + url.pathname,
    "wss://royal.example/api/comms/voice-agent/telnyx",
  );
  assert.equal(
    verifyStreamToken(url.searchParams.get("token"), SECRET)?.callControlId,
    "v3:abc",
  );
});

test("Mili done with a transfer: transcript kept, the stream stopped, the mobile rung", async () => {
  const { fetchImpl, requests } = recordingFetch();
  const recorder = recordingDb({
    "call.findUnique": { ...AGENT_CALL, provider: "TELNYX" },
  });
  await recordVoiceAgentOutcome(
    {
      db: recorder.transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
    },
    {
      callControlId: "v3:abc",
      callId: "call-1",
      outcome: "transfer",
      provider: "telnyx",
      turns: [
        { speaker: "caller", text: "Can I talk to someone?" },
        { speaker: "agent", text: "Sure, putting you through." },
      ],
    },
  );
  const update = recorder
    .writes()
    .find((call) => call.operation === "call.update")?.args as {
    data: Record<string, unknown>;
  };
  assert.equal(update.data.flowStep, "RINGING_MOBILE");
  assert.equal(
    update.data.agentTranscript,
    "Caller: Can I talk to someone?\nMili: Sure, putting you through.",
  );
  assert.deepEqual(
    requests.map((request) => request.url.replace(/^.*\/actions\//, "")),
    ["streaming_stop", "speak"],
  );
});

test("Mili done after the caller hung up: only the transcript is kept", async () => {
  const { fetchImpl, requests } = recordingFetch();
  const recorder = recordingDb({
    "call.findUnique": { ...AGENT_CALL, flowStep: "ENDED", provider: "TWILIO" },
  });
  await recordVoiceAgentOutcome(
    {
      db: recorder.transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
    },
    {
      callControlId: "CA1",
      callId: "call-1",
      outcome: "completed",
      provider: "twilio",
      turns: [{ speaker: "caller", text: "Bye" }],
    },
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["call.update"],
  );
});

test("Twilio: Mili done moves the live call on with new TwiML", async () => {
  const { fetchImpl, requests } = recordingFetch();
  await recordVoiceAgentOutcome(
    {
      db: recordingDb({
        "call.findUnique": { ...AGENT_CALL, provider: "TWILIO" },
      }).transactionalDb,
      log: quiet,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
    },
    {
      callControlId: "CA1",
      callId: "call-1",
      outcome: "completed",
      provider: "twilio",
      turns: [],
    },
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/Calls\/CA1\.json$/);
  assert.match(
    new URLSearchParams(requests[0].body).get("Twiml") ?? "",
    /<Hangup\/>/,
  );
});
