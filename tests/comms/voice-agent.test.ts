import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { twilioSignature } from "@/lib/comms/providers/twilio/signature";
import { encodeClientState } from "@/lib/comms/providers/telnyx/client-state";
import { handleCommsWebhook } from "@/lib/comms/webhook-handler";
import {
  linearToMuLaw,
  modelToPhone,
  muLawToLinear,
  phoneToModel,
} from "@/lib/comms/voice-agent/audio";
import {
  carrierClearFrame,
  carrierMediaFrame,
  parseCarrierFrame,
} from "@/lib/comms/voice-agent/frames";
import {
  START_TIMEOUT_MS,
  VoiceAgentSession,
  type VoiceAgentReportBody,
} from "@/lib/comms/voice-agent/session";
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
  VOICE_AGENT_MAX_SECONDS,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
} from "@/lib/domain/comms/calls/voice-agent";

import { recordingDb } from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// Mili, the voice agent: the phone-audio codec, the stream token, both
// carriers' stream frames, one conversation driven end to end, and the
// handover back to the call router when she is done.

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

// ── Audio ────────────────────────────────────────────────────────────

test("μ-law survives a round trip within its quantisation step", () => {
  for (const sample of [0, 1, -1, 100, -100, 1_000, -5_000, 20_000, -32_000]) {
    const back = muLawToLinear(linearToMuLaw(sample));
    const step = Math.max(8, Math.abs(sample) / 16);
    assert.ok(Math.abs(back - sample) <= step, `${sample} → ${back}`);
  }
});

test("a 20 ms phone frame becomes 20 ms of 24 kHz PCM, and back", () => {
  const phone = Buffer.alloc(160, linearToMuLaw(4_000));
  const pcm = phoneToModel(phone);
  assert.equal(pcm.length, 160 * 3 * 2);
  const pending = { bytes: Buffer.alloc(0) };
  const back = modelToPhone(pcm.subarray(0, pcm.length - 2), pending);
  assert.equal(back.length, 159, "an uneven tail waits for the next chunk");
  assert.equal(pending.bytes.length, 4);
  assert.equal(modelToPhone(pcm.subarray(pcm.length - 2), pending).length, 1);
});

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

test("audio and clear frames go back in each carrier's own shape", () => {
  assert.deepEqual(JSON.parse(carrierMediaFrame("twilio", "MZ1", "AA")), {
    event: "media",
    media: { payload: "AA" },
    streamSid: "MZ1",
  });
  assert.deepEqual(JSON.parse(carrierMediaFrame("telnyx", "s", "AA")), {
    event: "media",
    media: { payload: "AA" },
  });
  assert.deepEqual(JSON.parse(carrierClearFrame("twilio", "MZ1")), {
    event: "clear",
    streamSid: "MZ1",
  });
});

// ── Session ──────────────────────────────────────────────────────────

function harness(dialect: "twilio" | "telnyx" = "telnyx", urlToken?: string) {
  const carrierOut: string[] = [];
  const modelOut: { type: string; [key: string]: unknown }[] = [];
  const reports: VoiceAgentReportBody[] = [];
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
    dialect,
    log: quiet,
    now: () => clock,
    openModel: async () => {
      state.opened += 1;
      return {
        close: () => {
          state.modelClosed = true;
        },
        send: (event) => modelOut.push(event as never),
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
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    advance: (ms: number) => {
      clock += ms;
    },
    carrierOut,
    fire,
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

test("one conversation: greet, listen, speak, transcribe, then end_call reports and hangs up", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  assert.equal(h.state.opened, 1);
  assert.equal(h.modelOut[0].type, "session-update");
  const config = h.modelOut[0].config as Record<string, unknown>;
  assert.equal(config.voice, "marin");
  assert.deepEqual(config.inputAudioFormat, {
    rate: 24_000,
    type: "audio/pcm",
  });

  // Caller audio before the session is ready is dropped.
  const media = JSON.stringify({
    event: "media",
    media: {
      payload: Buffer.alloc(160, 0xff).toString("base64"),
      track: "inbound",
    },
  });
  h.session.handleCarrierText(media);
  assert.equal(h.modelOut.length, 1);

  h.session.handleModelEvent({ raw: {}, type: "session-updated" });
  assert.equal(h.modelOut[1].type, "response-create", "Mili speaks first");
  h.session.handleCarrierText(media);
  assert.equal(h.modelOut[2].type, "input-audio-append");

  // 40 ms of model audio → two 20 ms phone frames.
  h.session.handleModelEvent({
    delta: Buffer.alloc(960 * 2).toString("base64"),
    itemId: "i1",
    raw: {},
    responseId: "r1",
    type: "audio-delta",
  });
  const frames = h.carrierOut.map((text) => JSON.parse(text));
  assert.equal(frames.length, 2);
  assert.equal(Buffer.from(frames[0].media.payload, "base64").length, 160);

  h.session.handleModelEvent({ raw: {}, type: "speech-started" });
  assert.deepEqual(JSON.parse(h.carrierOut.at(-1) ?? ""), { event: "clear" });

  h.session.handleModelEvent({
    itemId: "i1",
    raw: {},
    responseId: "r1",
    transcript: "Hi, you're speaking with Mili.",
    type: "audio-transcript-done",
  });
  h.session.handleModelEvent({
    itemId: "u1",
    raw: {},
    transcript: "I'd like a quote for a knockdown rebuild.",
    type: "input-transcription-completed",
  });
  h.session.handleModelEvent({
    arguments: "{}",
    callId: "fc1",
    itemId: "i2",
    name: "end_call",
    raw: {},
    responseId: "r2",
    type: "function-call-arguments-done",
  });
  assert.equal(h.modelOut.at(-1)?.type, "conversation-item-create");
  assert.deepEqual(h.reports, [], "waits for her goodbye to finish playing");
  h.fire(h.timers.filter((t) => t.live).at(-1)?.ms ?? -1);
  await h.session.done;
  assert.deepEqual(h.reports, [
    {
      callControlId: "v3:abc",
      callId: "call-1",
      outcome: "completed",
      provider: "telnyx",
      turns: [
        { speaker: "agent", text: "Hi, you're speaking with Mili." },
        {
          speaker: "caller",
          text: "I'd like a quote for a knockdown rebuild.",
        },
      ],
    },
  ]);
  assert.equal(h.state.modelClosed, true);
  assert.equal(h.state.carrierClosed, true);
});

test("the model failing to start sends the caller to a person", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  h.session.handleModelEvent({ message: "nope", raw: {}, type: "error" });
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "failed");
});

test("the model dropping mid-call, or the caller asking for a person, hands back", async () => {
  const dropped = harness("telnyx", token("telnyx", "v3:abc"));
  dropped.session.handleCarrierText(telnyxStart());
  await dropped.tick();
  dropped.session.handleModelEvent({ raw: {}, type: "session-updated" });
  dropped.session.handleModelClosed();
  await dropped.session.done;
  assert.equal(dropped.reports[0]?.outcome, "failed");

  const transfer = harness("telnyx", token("telnyx", "v3:abc"));
  transfer.session.handleCarrierText(telnyxStart());
  await transfer.tick();
  transfer.session.handleModelEvent({ raw: {}, type: "session-updated" });
  transfer.session.handleModelEvent({
    arguments: '{"reason":"wants Ray"}',
    callId: "fc1",
    itemId: "i",
    name: "transfer_to_team",
    raw: {},
    responseId: "r",
    type: "function-call-arguments-done",
  });
  transfer.fire(transfer.timers.filter((t) => t.live).at(-1)?.ms ?? -1);
  await transfer.session.done;
  assert.equal(transfer.reports[0]?.outcome, "transfer");
});

test("near the time limit Mili is asked to wrap up; at it the call ends", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  h.session.handleModelEvent({ raw: {}, type: "session-updated" });
  h.fire((VOICE_AGENT_MAX_SECONDS - 45) * 1000);
  assert.deepEqual(h.modelOut.at(-1), {
    options: { instructions: VOICE_AGENT_WRAP_UP_INSTRUCTION },
    type: "response-create",
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
  h.session.handleModelEvent({ raw: {}, type: "session-updated" });
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
    },
  );
  const xml = await response.text();
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
    },
  );
  assert.deepEqual(
    requests.map((request) => request.url.replace(/^.*\/actions\//, "")),
    ["record_start", "streaming_start"],
  );
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
