import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { twilioSignature } from "@/lib/comms/providers/twilio/signature";
import { decodeClientState } from "@/lib/comms/providers/telnyx/client-state";
import {
  COMMS_WEBHOOK_MAX_BODY_BYTES,
  handleCommsWebhook,
} from "@/lib/comms/webhook-handler";
import { requestLeadCall } from "@/lib/domain/comms/calls/outbound";
import type { VoicePort } from "@/lib/domain/ports/comms";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// The public carrier webhook, end to end through the real domain against a
// recording database: what Twilio and Telnyx see when they call us.

const keys = generateKeyPairSync("ed25519");
const TELNYX_PUBLIC = (
  keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
)
  .subarray(12)
  .toString("base64");
const ORIGIN = "https://royal.example";
const NOW = new Date("2026-11-05T00:00:00Z");

const ENV = {
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

const quiet = { error: () => {}, info: () => {}, warn: () => {} };

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
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
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

function deps(
  script: Record<string, unknown>,
  fetchImpl: typeof fetch = async () => new Response("{}"),
) {
  const recorder = recordingDb(script);
  return {
    deps: {
      allow: () => true,
      db: recorder.transactionalDb,
      log: quiet,
      now: () => NOW,
      runtime: commsRuntimeFromEnv(ENV, fetchImpl),
    },
    recorder,
  };
}

// A chunked request body that notices when the reader gives up on it.
function streamedRequest(
  url: string,
  headers: Record<string, string>,
  chunks: number,
  chunkSize: number,
) {
  const seen = { cancelled: false, pulled: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      cancel() {
        seen.cancelled = true;
      },
      pull(controller) {
        if (seen.pulled >= chunks) {
          controller.close();
          return;
        }
        seen.pulled += 1;
        controller.enqueue(new Uint8Array(chunkSize).fill(0x78));
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(url, {
    body,
    duplex: "half",
    headers,
    method: "POST",
  } as RequestInit);
  return { request, seen };
}

const NO_STAFF_ONLINE = { "user.findMany": [] };

test("an unknown provider or event is a 404, and nothing is read", async () => {
  const { deps: d, recorder } = deps({});
  assert.equal(
    (
      await handleCommsWebhook(
        new Request(`${ORIGIN}/x`, { method: "POST" }),
        { event: "sms", provider: "plivo" },
        d,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handleCommsWebhook(
        new Request(`${ORIGIN}/x`, { method: "POST" }),
        { event: "nope", provider: "twilio" },
        d,
      )
    ).status,
    404,
  );
  assert.deepEqual(recorder.calls, []);
});

test("a bad signature is a 403 with no database access", async () => {
  const { deps: d, recorder } = deps({});
  const forged = new Request(`${ORIGIN}/api/comms/twilio/sms-inbound`, {
    body: "MessageSid=SM1&From=%2B61412345678&To=%2B61280001234&Body=Hi",
    headers: { "x-twilio-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    method: "POST",
  });
  assert.equal(
    (
      await handleCommsWebhook(
        forged,
        { event: "sms-inbound", provider: "twilio" },
        d,
      )
    ).status,
    403,
  );
  // Signed for Telnyx, sent to the Twilio path: still refused.
  const crossed = telnyxRequest("sms", {
    data: { event_type: "message.received", id: "e", payload: {} },
  });
  assert.equal(
    (
      await handleCommsWebhook(
        crossed,
        { event: "sms-inbound", provider: "twilio" },
        d,
      )
    ).status,
    403,
  );
  assert.deepEqual(recorder.calls, []);
});

test("Twilio: an inbound call rings the office mobile when no browser is open, as TwiML", async () => {
  const { deps: d, recorder } = deps({
    ...NO_STAFF_ONLINE,
    "call.create": { id: "call-1" },
    "call.findUnique": null,
    "lead.findMany": [{ id: 7 }],
  });
  const response = await handleCommsWebhook(
    twilioRequest("voice-inbound", {
      CallSid: "CA1",
      From: "+61412345678",
      To: "+61280001234",
    }),
    { event: "voice-inbound", provider: "twilio" },
    d,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /xml/);
  const xml = await response.text();
  assert.match(
    xml,
    /<Dial callerId="\+61280001234"[^>]*action="https:\/\/royal\.example\/api\/comms\/twilio\/voice-dial\?callId=call-1"/,
  );
  assert.match(xml, /<Number [^>]*>\+61400000000<\/Number>/);
  const created = recorder
    .writes()
    .find((call) => call.operation === "call.create");
  assert.deepEqual(
    (created?.args as { data: Record<string, unknown> }).data.provider,
    "TWILIO",
  );
  assert.equal((created?.args as { data: { leadId: number } }).data.leadId, 7);
});

test("Telnyx: an inbound call is answered by command, and the webhook answers an empty 200", async () => {
  const commands: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    commands.push({
      body: JSON.parse(String(init.body ?? "{}")),
      url: String(url),
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { deps: d } = deps(
    {
      ...NO_STAFF_ONLINE,
      "call.create": { id: "call-9" },
      "call.findUnique": null,
      "commsWebhookEvent.findUnique": null,
      "lead.findMany": [],
    },
    fetchImpl,
  );
  const response = await handleCommsWebhook(
    telnyxRequest("voice", {
      data: {
        event_type: "call.initiated",
        id: "evt-1",
        payload: {
          call_control_id: "v3:in",
          direction: "incoming",
          from: "+61412345678",
          to: "+61290001234",
        },
      },
    }),
    { event: "voice", provider: "telnyx" },
    d,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(commands.length, 1);
  assert.equal(
    commands[0].url,
    "https://api.telnyx.com/v2/calls/v3%3Ain/actions/answer",
  );
  assert.deepEqual(
    decodeClientState(
      (commands[0].body as { client_state: string }).client_state,
    ),
    { c: "call-9", r: "a" },
  );
});

test("Telnyx with calling switched off hangs up a ringing call without answering it", async () => {
  const commands: string[] = [];
  const fetchImpl = (async (url: string) => {
    commands.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { deps: d } = deps({ "commsWebhookEvent.findUnique": null }, fetchImpl);
  const response = await handleCommsWebhook(
    telnyxRequest("voice", {
      data: {
        event_type: "call.initiated",
        id: "evt-off",
        payload: {
          call_control_id: "v3:in",
          direction: "incoming",
          from: "+61412345678",
          to: "+61290001234",
        },
      },
    }),
    { event: "voice", provider: "telnyx" },
    {
      ...d,
      runtime: commsRuntimeFromEnv(
        { ...ENV, COMMS_CALLS_ENABLED: "false" },
        fetchImpl,
      ),
    },
  );
  assert.equal(response.status, 200);
  // Answering would bill the call just to say "not in service".
  assert.deepEqual(commands, [
    "https://api.telnyx.com/v2/calls/v3%3Ain/actions/hangup",
  ]);
});

test("a Telnyx event already processed is acknowledged without touching the domain", async () => {
  const { deps: d, recorder } = deps({
    "commsWebhookEvent.findUnique": { processedAt: new Date() },
  });
  const response = await handleCommsWebhook(
    telnyxRequest("sms", {
      data: {
        event_type: "message.received",
        id: "evt-dup",
        payload: {
          from: { phone_number: "+61412345678" },
          id: "m1",
          text: "Hi",
          to: [{ phone_number: "+61290001234" }],
        },
      },
    }),
    { event: "sms", provider: "telnyx" },
    d,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(recorder.operations(), ["commsWebhookEvent.findUnique"]);
});

test("a database failure answers 500 so the carrier retries, never a false 200", async () => {
  const { deps: d } = deps({
    "commsWebhookEvent.findUnique": null,
    "smsMessage.findUnique": () => {
      throw new Error("database down");
    },
  });
  const response = await handleCommsWebhook(
    telnyxRequest("sms", {
      data: {
        event_type: "message.received",
        id: "evt-2",
        payload: {
          from: { phone_number: "+61412345678" },
          id: "m2",
          text: "Hi",
          to: [{ phone_number: "+61290001234" }],
        },
      },
    }),
    { event: "sms", provider: "telnyx" },
    d,
  );
  assert.equal(response.status, 500);
});

test("switching provider changes no business behaviour: the same call writes the same rows", async () => {
  // File 06 §10 test 10: the same CRM action through each adapter.
  async function place(provider: "twilio" | "telnyx") {
    const recorder = recordingDb({
      "call.findUnique": (args: { where: Record<string, unknown> }) =>
        "idempotencyKey" in args.where && !("id" in args.where)
          ? null
          : {
              answeredAt: null,
              answeredBy: null,
              businessNumber: "+61280001234",
              candidateLeadIds: [],
              connectedAt: null,
              customerNumber: "+61412345678",
              direction: "OUTBOUND",
              durationSeconds: null,
              endedAt: null,
              flowStep: "DIALING_CUSTOMER",
              hangupCause: null,
              id: "call-1",
              lead: { id: 7, name: "Sam" },
              leadId: 7,
              needsReconciliation: false,
              provider: provider.toUpperCase(),
              providerErrorTitle: null,
              recordingConsent: "NOT_ASKED",
              recordings: [],
              staffTarget: "BROWSER",
              staffUser: null,
              startedAt: NOW,
              status: "INITIATED",
            },
      "call.upsert": { id: "call-1" },
      "lead.findUnique": {
        assignedId: null,
        id: 7,
        isArchived: false,
        phone: "0412345678",
      },
      "outboxEvent.findUnique": {
        attempts: 0,
        id: "ob",
        key: "k",
        kind: "LEAD_CALL_PLACE",
        payload: {},
        status: "PENDING",
      },
      "outboxEvent.updateMany": { count: 1 },
      "outboxEvent.upsert": {
        id: "ob",
        key: "k",
        result: null,
        status: "PENDING",
      },
    });
    const voice: VoicePort = {
      endCall: async () => {},
      lookupCall: async () => ({ found: false }),
      placeCall: async () => ({ providerCallId: "PROVIDER-ID" }),
      provider,
    };
    await requestLeadCall(
      adminPrincipal(),
      { idempotencyKey: "k", leadId: 7, now: NOW, target: "browser" },
      recorder.transactionalDb,
      {
        channel: {
          browserCalling: true,
          browserRingGroup: provider === "twilio",
          callsAvailable: true,
          defaultNumber: { e164: "+61280001234", label: "Office", provider },
          numbers: [],
          provider,
          recordingMode: "off",
          smsAvailable: true,
          staffForwardNumber: null,
        },
        voice,
      },
    );
    // The provider column and the outbox payload name the carrier; nothing else may differ.
    return JSON.parse(
      JSON.stringify(recorder.writes())
        .replaceAll(`"${provider.toUpperCase()}"`, '"PROVIDER"')
        .replaceAll(`"${provider}"`, '"provider"')
        // Wall-clock stamps (outbox locks) differ by a millisecond run to run.
        .replace(/"\d{4}-\d\d-\d\dT[\d:.]+Z"/g, '"<time>"'),
    );
  }
  const twilio = await place("twilio");
  assert.ok(twilio.length > 0);
  assert.deepEqual(await place("telnyx"), twilio);
});

test("retrying a refused call on the same key rings whichever target this attempt chose", async () => {
  // The browser attempt was refused outright (nothing rang); the same click
  // intent retried as "office mobile" must ring the mobile, not the browser.
  const failed = {
    answeredAt: null,
    answeredBy: null,
    businessNumber: "+61280001234",
    candidateLeadIds: [],
    connectedAt: null,
    customerNumber: "+61412345678",
    direction: "OUTBOUND",
    durationSeconds: null,
    endedAt: NOW,
    flowStep: "ENDED",
    hangupCause: null,
    id: "call-1",
    lead: { id: 7, name: "Sam" },
    leadId: 7,
    needsReconciliation: false,
    provider: "TWILIO",
    providerErrorTitle: "Refused",
    recordingConsent: "NOT_ASKED",
    recordings: [],
    staffTarget: "BROWSER",
    staffUser: null,
    startedAt: NOW,
    status: "FAILED",
  };
  const recorder = recordingDb({
    "call.findUnique": failed,
    "call.upsert": { id: "call-1" },
    "lead.findUnique": {
      assignedId: null,
      id: 7,
      isArchived: false,
      phone: "0412345678",
    },
    "outboxEvent.findUnique": {
      attempts: 1,
      id: "ob",
      key: "k",
      kind: "LEAD_CALL_PLACE",
      payload: {},
      status: "PENDING",
    },
    "outboxEvent.updateMany": { count: 1 },
    "outboxEvent.upsert": {
      id: "ob",
      key: "k",
      result: null,
      status: "PENDING",
    },
  });
  await requestLeadCall(
    adminPrincipal(),
    { idempotencyKey: "k", leadId: 7, now: NOW, target: "mobile" },
    recorder.transactionalDb,
    {
      channel: {
        browserCalling: true,
        browserRingGroup: true,
        callsAvailable: true,
        defaultNumber: {
          e164: "+61280001234",
          label: "Office",
          provider: "twilio",
        },
        numbers: [],
        provider: "twilio",
        recordingMode: "off",
        smsAvailable: true,
        staffForwardNumber: "+61400000000",
      },
      voice: {
        endCall: async () => {},
        lookupCall: async () => ({ found: false }),
        placeCall: async () => ({ providerCallId: "CA1" }),
        provider: "twilio",
      },
    },
  );
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  assert.equal(
    (upsert?.args as { update: { staffTarget: string } }).update.staffTarget,
    "MOBILE",
  );
});

for (const [label, headers] of [
  ["missing", {}],
  ["understated", { "content-length": "10" }],
] as const) {
  test(`a body over the cap with a ${label} content-length is cut off and refused`, async () => {
    const { deps: d, recorder } = deps({});
    const chunk = 4 * 1024;
    const chunks = Math.ceil(COMMS_WEBHOOK_MAX_BODY_BYTES / chunk) + 50;
    const { request, seen } = streamedRequest(
      `${ORIGIN}/api/comms/twilio/sms-inbound`,
      {
        ...headers,
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
      chunks,
      chunk,
    );
    const response = await handleCommsWebhook(
      request,
      { event: "sms-inbound", provider: "twilio" },
      d,
    );
    assert.equal(response.status, 413);
    assert.equal(seen.cancelled, true, "the upload was cancelled");
    assert.ok(seen.pulled < chunks, `stopped early (read ${seen.pulled})`);
    assert.deepEqual(recorder.calls, []);
  });
}
