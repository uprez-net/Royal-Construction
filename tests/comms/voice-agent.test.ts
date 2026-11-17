import assert from "node:assert/strict";
import { test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  carrierMediaFrame,
  parseCarrierFrame,
} from "@/lib/comms/voice-agent/frames";
import {
  mintLiveClientSecret,
  parseLiveServerEvent,
} from "@/lib/comms/voice-agent/live";
import { VOICE_AGENT_MODEL } from "@/lib/comms/voice-agent/settings";
import { voiceAgentWarmUrl } from "@/lib/comms/voice-agent/stream";
import { handleVoiceAgentStream } from "@/lib/comms/voice-agent/stream-handler";
import { verifyStreamToken } from "@/lib/comms/voice-agent/token";
import { VOICE_AGENT_MAX_SECONDS } from "@/lib/domain/comms/calls/voice-agent";

import { recordingDb } from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";
import { SECRET, NOW, ORIGIN, quiet, ENV, token } from "./voice-agent-harness";

// Mili, the voice agent: the stream token, both carriers' stream frames, the
// GPT-Live socket's events and credential, and the stream route. The session
// itself is in voice-agent-session.test.ts, the carriers end to end in
// voice-agent-carriers.test.ts, and who is calling in
// voice-agent-callers.test.ts.

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
