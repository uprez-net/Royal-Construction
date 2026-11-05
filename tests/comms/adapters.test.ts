import assert from "node:assert/strict";
import { test } from "vitest";

import { readCommsConfig } from "@/lib/comms/config";
import {
  encodeClientState,
  decodeClientState,
} from "@/lib/comms/providers/telnyx/client-state";
import { createTelnyxAdapter } from "@/lib/comms/providers/telnyx";
import {
  parseTelnyxWebhook,
  stateFromHangupCause,
} from "@/lib/comms/providers/telnyx/parse";
import { createTwilioAdapter } from "@/lib/comms/providers/twilio";
import { parseTwilioWebhook } from "@/lib/comms/providers/twilio/parse";
import { renderTwiml } from "@/lib/comms/providers/twilio/twiml";
import type { WebhookRequest } from "@/lib/comms/types";
import { CommsError } from "@/lib/domain/ports/comms";

// The two adapters against the same neutral contract (file 06 §10, tests
// 1, 2, 7, 9, 12): the request each sends, how each classifies a failure, and
// the neutral events each parses. `fetch` is faked; nothing leaves the test.

const ENV = {
  COMMS_CALLS_ENABLED: "true",
  COMMS_PHONE_NUMBERS: "+61280001234=twilio=Office,+61290001234=telnyx=Office",
  COMMS_SMS_ENABLED: "true",
  COMMS_WEBHOOK_ORIGIN: "https://royal.example",
  TELNYX_API_KEY: "KEY123",
  TELNYX_CONNECTION_ID: "conn-1",
  TELNYX_MESSAGING_PROFILE_ID: "profile-1",
  TELNYX_PUBLIC_KEY: Buffer.alloc(32, 1).toString("base64"),
  TELNYX_WEBRTC_CONNECTION_ID: "webrtc-1",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_API_KEY_SID: "SK00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "token",
};
const config = readCommsConfig(ENV);

type Recorded = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
};

function fakeFetch(
  responses: Array<{ status: number; body: unknown } | Error>,
) {
  const requests: Recorded[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    requests.push({
      body: init.body as string | undefined,
      headers: init.headers as Record<string, string>,
      method: init.method ?? "GET",
      url: String(url),
    });
    const next = responses.shift() ?? { body: {}, status: 200 };
    if (next instanceof Error) throw next;
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      { status: next.status },
    );
  }) as typeof fetch;
  return { impl, requests };
}

function webhook(event: string, body: string, query = ""): WebhookRequest {
  return {
    event,
    headers: new Headers(),
    now: new Date("2026-11-05T00:00:00Z"),
    query: new URLSearchParams(query),
    rawBody: body,
    signedUrl: `https://royal.example/api/comms/x/${event}${query ? `?${query}` : ""}`,
  };
}

// ── Twilio ─────────────────────────────────────────────────────────────

test("Twilio: an SMS is a form POST with Basic auth and a status callback, and returns the SID", async () => {
  const fake = fakeFetch([{ body: { sid: "SM123" }, status: 201 }]);
  const adapter = createTwilioAdapter(config, fake.impl);
  const receipt = await adapter.sms?.sendSms({
    body: "Hello",
    from: "+61280001234",
    to: "+61412345678",
  });
  assert.deepEqual(receipt, { providerMessageId: "SM123" });
  const [request] = fake.requests;
  assert.equal(
    request.url,
    "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json",
  );
  assert.equal(
    request.headers.Authorization,
    `Basic ${Buffer.from(`${ENV.TWILIO_API_KEY_SID}:secret`).toString("base64")}`,
  );
  const form = new URLSearchParams(request.body);
  assert.equal(form.get("To"), "+61412345678");
  assert.equal(
    form.get("StatusCallback"),
    "https://royal.example/api/comms/twilio/sms-status",
  );
});

test("Twilio: a call carries Royal's call id on every callback URL", async () => {
  const fake = fakeFetch([{ body: { sid: "CA9" }, status: 201 }]);
  const adapter = createTwilioAdapter(config, fake.impl);
  const placed = await adapter.voice?.placeCall({
    callId: "call-1",
    from: "+61280001234",
    timeLimitSeconds: 14_400,
    timeoutSeconds: 30,
    to: "+61412345678",
  });
  assert.deepEqual(placed, { providerCallId: "CA9" });
  const form = new URLSearchParams(fake.requests[0].body);
  assert.equal(
    form.get("Url"),
    "https://royal.example/api/comms/twilio/voice-connect?callId=call-1",
  );
  assert.equal(
    form.get("StatusCallback"),
    "https://royal.example/api/comms/twilio/voice-status?callId=call-1",
  );
  assert.deepEqual(form.getAll("StatusCallbackEvent"), [
    "initiated",
    "ringing",
    "answered",
    "completed",
  ]);
});

test("Twilio: a 4xx is a definite refusal, a 5xx or timeout is uncertain, with a stable code", async () => {
  const refused = createTwilioAdapter(
    config,
    fakeFetch([{ body: { code: 21211, message: "Invalid To" }, status: 400 }])
      .impl,
  );
  await assert.rejects(
    () =>
      refused.sms!.sendSms({
        body: "x",
        from: "+61280001234",
        to: "+61400000000",
      }),
    (error: unknown) =>
      error instanceof CommsError
      && error.kind === "rejected"
      && error.providerCode === "TWILIO_21211",
  );
  const broken = createTwilioAdapter(
    config,
    fakeFetch([{ body: {}, status: 503 }]).impl,
  );
  await assert.rejects(
    () =>
      broken.sms!.sendSms({
        body: "x",
        from: "+61280001234",
        to: "+61400000000",
      }),
    (error: unknown) =>
      error instanceof CommsError && error.kind === "uncertain",
  );
  const throttled = createTwilioAdapter(
    config,
    fakeFetch([{ body: {}, status: 429 }]).impl,
  );
  await assert.rejects(
    () =>
      throttled.sms!.sendSms({
        body: "x",
        from: "+61280001234",
        to: "+61400000000",
      }),
    (error: unknown) =>
      error instanceof CommsError && error.kind === "uncertain",
    "429 may have been accepted",
  );
  const timeout = createTwilioAdapter(
    config,
    fakeFetch([new DOMException("timeout", "TimeoutError")]).impl,
  );
  await assert.rejects(
    () =>
      timeout.sms!.sendSms({
        body: "x",
        from: "+61280001234",
        to: "+61400000000",
      }),
    (error: unknown) =>
      error instanceof CommsError && error.kind === "uncertain",
  );
});

test("Twilio: TwiML escapes text, carries the call id, and records only when told to", () => {
  const xml = renderTwiml(
    [
      { op: "say", text: "Tom & Jerry's <build>" },
      {
        callerId: "+61412345678",
        identities: ["crm_a", "crm_b"],
        op: "dialBrowser",
        record: false,
        timeoutSeconds: 20,
      },
    ],
    { callId: "call-1", origin: "https://royal.example" },
  );
  assert.match(xml, /Tom &amp; Jerry&apos;s &lt;build&gt;/);
  assert.match(
    xml,
    /<Client [^>]*><Identity>crm_a<\/Identity><Parameter name="callId" value="call-1"\/><\/Client>/,
  );
  assert.match(xml, /<Identity>crm_b<\/Identity>/);
  assert.match(
    xml,
    /action="https:\/\/royal\.example\/api\/comms\/twilio\/voice-dial\?callId=call-1"/,
  );
  assert.doesNotMatch(xml, /record=/);
  const recorded = renderTwiml(
    [
      {
        callerId: "+61280001234",
        op: "dialNumber",
        record: true,
        timeoutSeconds: 20,
        to: "+61400000000",
      },
    ],
    { callId: "c", origin: "https://royal.example" },
  );
  assert.match(recorded, /record="record-from-answer-dual"/);
  assert.equal(
    renderTwiml(null, { callId: null, origin: "https://royal.example" }),
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

test("Twilio: callbacks parse into neutral events", () => {
  const inbound = parseTwilioWebhook(
    webhook(
      "sms-inbound",
      "MessageSid=SM1&From=%2B61412345678&To=%2B61280001234&Body=Hi&NumMedia=1",
    ),
  );
  assert.deepEqual(inbound?.events[0], {
    body: "Hi",
    from: "+61412345678",
    mediaCount: 1,
    providerMessageId: "SM1",
    receivedAt: new Date("2026-11-05T00:00:00Z"),
    to: "+61280001234",
    type: "sms.received",
  });
  assert.equal(inbound?.respondWith, "markup");

  const status = parseTwilioWebhook(
    webhook(
      "sms-status",
      "MessageSid=SM1&MessageStatus=undelivered&ErrorCode=30003",
    ),
  );
  assert.equal(
    status?.events[0].type === "sms.status" && status.events[0].status,
    "FAILED",
  );
  assert.equal(status?.dedupeKey, "sms:SM1:FAILED");

  const dial = parseTwilioWebhook(
    webhook(
      "voice-dial",
      "CallSid=CA1&DialCallStatus=no-answer",
      "callId=call-1",
    ),
  );
  assert.deepEqual(dial?.events[0], {
    callId: "call-1",
    durationSeconds: null,
    outcome: "no-answer",
    providerCallId: "CA1",
    type: "call.dialed",
  });

  const withheld = parseTwilioWebhook(
    webhook("voice-inbound", "CallSid=CA2&From=anonymous&To=%2B61280001234"),
  );
  assert.equal(
    withheld?.events[0].type === "call.incoming" && withheld.events[0].from,
    "withheld",
  );

  assert.equal(
    parseTwilioWebhook(webhook("sms-inbound", "From=%2B61412345678")),
    null,
    "no SID, no event",
  );
});

// ── Telnyx ─────────────────────────────────────────────────────────────

function telnyxEvent(
  type: string,
  payload: Record<string, unknown>,
  id = "evt-1",
) {
  return JSON.stringify({
    data: {
      event_type: type,
      id,
      occurred_at: "2026-11-05T00:00:00Z",
      payload,
    },
  });
}

test("Telnyx: an SMS is JSON with a Bearer key, the messaging profile and a status webhook", async () => {
  const fake = fakeFetch([{ body: { data: { id: "msg-1" } }, status: 200 }]);
  const adapter = createTelnyxAdapter(config, fake.impl);
  assert.deepEqual(
    await adapter.sms?.sendSms({
      body: "Hello",
      from: "+61290001234",
      to: "+61412345678",
    }),
    {
      providerMessageId: "msg-1",
    },
  );
  const [request] = fake.requests;
  assert.equal(request.url, "https://api.telnyx.com/v2/messages");
  assert.equal(request.headers.Authorization, "Bearer KEY123");
  assert.deepEqual(JSON.parse(request.body ?? ""), {
    from: "+61290001234",
    messaging_profile_id: "profile-1",
    text: "Hello",
    to: "+61412345678",
    webhook_url: "https://royal.example/api/comms/telnyx/sms",
  });
});

test("Telnyx: a call goes to the Call Control app with Royal's id in client state and the webhook", async () => {
  const fake = fakeFetch([
    { body: { data: { call_control_id: "v3:abc" } }, status: 200 },
  ]);
  const adapter = createTelnyxAdapter(config, fake.impl);
  const placed = await adapter.voice?.placeCall({
    callId: "call-1",
    from: "+61290001234",
    timeLimitSeconds: 14_400,
    timeoutSeconds: 30,
    to: "+61412345678",
  });
  assert.deepEqual(placed, { providerCallId: "v3:abc" });
  const body = JSON.parse(fake.requests[0].body ?? "");
  assert.equal(body.connection_id, "conn-1");
  assert.equal(
    body.webhook_url,
    "https://royal.example/api/comms/telnyx/voice?callId=call-1",
  );
  assert.deepEqual(decodeClientState(body.client_state), {
    c: "call-1",
    r: "a",
  });
});

test("Telnyx: instructions run as commands, and speech carries the rest in client state", async () => {
  const fake = fakeFetch([{ body: {}, status: 200 }]);
  const adapter = createTelnyxAdapter(config, fake.impl);
  await adapter.respond(
    [
      { op: "say", text: "Sorry, nobody is available." },
      { maxSeconds: 120, op: "recordVoicemail" },
      { op: "hangup" },
    ],
    { callId: "call-1", providerCallId: "v3:abc", trigger: "call.dialed" },
  );
  assert.equal(
    fake.requests.length,
    1,
    "one command, then wait for speak.ended",
  );
  assert.equal(
    fake.requests[0].url,
    "https://api.telnyx.com/v2/calls/v3%3Aabc/actions/speak",
  );
  const state = decodeClientState(
    JSON.parse(fake.requests[0].body ?? "").client_state,
  );
  assert.deepEqual(state?.n, [
    { maxSeconds: 120, op: "recordVoicemail" },
    { op: "hangup" },
  ]);

  const ended = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.speak.ended", {
        call_control_id: "v3:abc",
        client_state: encodeClientState(state!),
      }),
    ),
  );
  assert.deepEqual(ended?.pending?.instructions, state?.n);
});

test("Telnyx: an incoming call is answered first; its answered event asks for the first step", async () => {
  const fake = fakeFetch([{ body: {}, status: 200 }]);
  const adapter = createTelnyxAdapter(config, fake.impl);
  await adapter.respond(
    [
      {
        numDigits: 1,
        op: "gatherDigits",
        prompt: "Press 1",
        timeoutSeconds: 6,
      },
    ],
    {
      callId: "call-1",
      providerCallId: "v3:in",
      trigger: "call.incoming",
    },
  );
  assert.equal(fake.requests.length, 1);
  assert.match(fake.requests[0].url, /\/actions\/answer$/);
});

test("Telnyx: ringing a browser looks up the identity's SIP user and transfers to it", async () => {
  const fake = fakeFetch([
    {
      body: { data: [{ id: "cred-1", sip_username: "gencredabc" }] },
      status: 200,
    },
    { body: {}, status: 200 },
  ]);
  const adapter = createTelnyxAdapter(config, fake.impl);
  await adapter.respond(
    [
      {
        callerId: "+61412345678",
        identities: ["crm_lookup"],
        op: "dialBrowser",
        record: true,
        timeoutSeconds: 20,
      },
    ],
    { callId: "call-1", providerCallId: "v3:abc", trigger: "call.answered" },
  );
  assert.match(
    fake.requests[0].url,
    /telephony_credentials\?filter\[tag\]=crm_lookup/,
  );
  const transfer = JSON.parse(fake.requests[1].body ?? "");
  assert.equal(transfer.to, "sip:gencredabc@sip.telnyx.com");
  assert.deepEqual(decodeClientState(transfer.client_state), {
    a: "v3:abc",
    c: "call-1",
    r: "b",
    rec: 1,
  });
});

test("Telnyx: a failing command still answers 200 (a retried event cannot redo it)", async () => {
  const adapter = createTelnyxAdapter(
    config,
    fakeFetch([{ body: { errors: [{ code: "90018" }] }, status: 422 }]).impl,
  );
  const quiet = console.error;
  console.error = () => {};
  try {
    const response = await adapter.respond([{ op: "say", text: "x" }], {
      callId: "c",
      providerCallId: "v3:gone",
      trigger: "call.answered",
    });
    assert.equal(response.status, 200);
  } finally {
    console.error = quiet;
  }
});

test("Telnyx: call events parse by leg — the customer's leg is a status, a staff leg is the dial", () => {
  const incoming = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.initiated", {
        call_control_id: "v3:in",
        direction: "incoming",
        from: "+61412345678",
        to: "+61290001234",
      }),
    ),
  );
  assert.deepEqual(incoming?.events[0], {
    from: "+61412345678",
    providerCallId: "v3:in",
    to: "+61290001234",
    type: "call.incoming",
  });

  const staffState = encodeClientState({
    a: "v3:a",
    c: "call-1",
    r: "b",
    rec: 1,
  });
  const answered = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.answered", {
        call_control_id: "v3:b",
        client_state: staffState,
      }),
    ),
  );
  assert.deepEqual(answered?.events[0], {
    callId: "call-1",
    providerCallId: "v3:a",
    type: "call.connected",
  });
  assert.deepEqual(answered?.recordAfterConnect, {
    callId: "call-1",
    providerCallId: "v3:a",
  });

  const missed = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.hangup", {
        call_control_id: "v3:b",
        client_state: staffState,
        hangup_cause: "timeout",
      }),
    ),
  );
  assert.equal(
    missed?.events[0].type === "call.dialed" && missed.events[0].outcome,
    "no-answer",
  );

  const ended = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.hangup", {
        call_control_id: "v3:a",
        client_state: encodeClientState({ c: "call-1", r: "a" }),
        end_time: "2026-11-05T00:02:05Z",
        hangup_cause: "normal_clearing",
        start_time: "2026-11-05T00:00:00Z",
      }),
    ),
  );
  assert.equal(
    ended?.events[0].type === "call.status" && ended.events[0].state,
    "completed",
  );
  assert.equal(
    ended?.events[0].type === "call.status" && ended.events[0].durationSeconds,
    125,
  );
  assert.equal(ended?.dedupeKey, "evt-1", "Telnyx retries reuse the event id");
});

test("Telnyx: hangup causes map onto the persisted vocabulary", () => {
  assert.equal(stateFromHangupCause("user_busy"), "busy");
  assert.equal(stateFromHangupCause("call_rejected"), "busy");
  assert.equal(stateFromHangupCause("originator_cancel"), "canceled");
  assert.equal(stateFromHangupCause("no_answer"), "no-answer");
  assert.equal(stateFromHangupCause("something_new"), "failed");
});

test("Telnyx: messaging events parse, and an unproven delivery is never shown as delivered", () => {
  const received = parseTelnyxWebhook(
    webhook(
      "sms",
      telnyxEvent("message.received", {
        from: { phone_number: "+61412345678" },
        id: "msg-in",
        media: [{}, {}],
        text: "STOP",
        to: [{ phone_number: "+61290001234" }],
      }),
    ),
  );
  assert.equal(
    received?.events[0].type === "sms.received"
      && received.events[0].mediaCount,
    2,
  );
  const unconfirmed = parseTelnyxWebhook(
    webhook(
      "sms",
      telnyxEvent("message.finalized", {
        id: "msg-1",
        to: [{ status: "delivery_unconfirmed" }],
      }),
    ),
  );
  assert.equal(
    unconfirmed?.events[0].type === "sms.status"
      && unconfirmed.events[0].status,
    "SENT",
  );
  const unknown = parseTelnyxWebhook(
    webhook(
      "voice",
      telnyxEvent("call.machine.detection.ended", { call_control_id: "v3:x" }),
    ),
  );
  assert.deepEqual(
    unknown?.events,
    [],
    "an unknown event is acknowledged and ignored",
  );
  assert.equal(parseTelnyxWebhook(webhook("voice", "not json")), null);
});
