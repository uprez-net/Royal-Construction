import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { twilioSignature } from "@/lib/comms/providers/twilio/signature";
import { encodeClientState } from "@/lib/comms/providers/telnyx/client-state";
import { handleCommsWebhook } from "@/lib/comms/webhook-handler";
import { recordVoiceAgentOutcome } from "@/lib/comms/voice-agent/stream-handler";
import { verifyStreamToken } from "@/lib/comms/voice-agent/token";
import { PROMPTS } from "@/lib/domain/comms/calls/flow";
import { VOICE_AGENT_MAX_SECONDS } from "@/lib/domain/comms/calls/voice-agent";

import { recordingDb } from "../architecture/domain-harness";
import { SECRET, NOW, ORIGIN, quiet, keys, ENV } from "./voice-agent-harness";

// Both carriers end to end: an inbound call reaching Mili, the recording, and
// the handover back to the call router when she is done.

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
