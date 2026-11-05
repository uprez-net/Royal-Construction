import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "vitest";

import { verifyTelnyxSignature } from "@/lib/comms/providers/telnyx/signature";
import {
  twilioSignature,
  verifyTwilioSignature,
} from "@/lib/comms/providers/twilio/signature";

// Both carriers' webhook signatures (file 06 §10, test 6). A carrier webhook
// writes onto leads from the open internet: every way a signature can be
// wrong must be a rejection.

const URL = "https://royal.example/api/comms/twilio/sms-inbound";
const PARAMS = new URLSearchParams({
  Body: "Hi",
  From: "+61412345678",
  MessageSid: "SM1",
  To: "+61280001234",
});

function twilioHeaders(token: string, url = URL, params = PARAMS) {
  return new Headers({
    "x-twilio-signature": twilioSignature(token, url, params),
  });
}

test("Twilio: the documented example signs as Twilio publishes it", () => {
  // From Twilio's webhook-security docs.
  const params = new URLSearchParams({
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  });
  assert.equal(
    twilioSignature(
      "12345",
      "https://mycompany.com/myapp.php?foo=1&bar=2",
      params,
    ),
    "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
  );
});

test("Twilio: a valid signature passes, with the current or the previous token", () => {
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["token"],
      headers: twilioHeaders("token"),
      params: PARAMS,
      url: URL,
    }),
    true,
  );
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["new", "old"],
      headers: twilioHeaders("old"),
      params: PARAMS,
      url: URL,
    }),
    true,
  );
});

test("Twilio: a tampered body, another URL, a wrong token or no header is refused", () => {
  const headers = twilioHeaders("token");
  const tampered = new URLSearchParams(PARAMS);
  tampered.set("Body", "Hi there");
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["token"],
      headers,
      params: tampered,
      url: URL,
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["token"],
      headers,
      params: PARAMS,
      url: `${URL}?x=1`,
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["other"],
      headers,
      params: PARAMS,
      url: URL,
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({
      authTokens: ["token"],
      headers: new Headers(),
      params: PARAMS,
      url: URL,
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({
      authTokens: [null],
      headers,
      params: PARAMS,
      url: URL,
    }),
    false,
  );
});

const keys = generateKeyPairSync("ed25519");
const PUBLIC_KEY = (
  keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
)
  .subarray(12)
  .toString("base64");

function telnyxHeaders(
  body: string,
  timestamp: number,
  privateKey = keys.privateKey,
) {
  return new Headers({
    "telnyx-signature-ed25519": sign(
      null,
      Buffer.from(`${timestamp}|${body}`),
      privateKey,
    ).toString("base64"),
    "telnyx-timestamp": String(timestamp),
  });
}

const BODY = JSON.stringify({
  data: { event_type: "message.received", id: "evt-1", payload: {} },
});
const NOW = new Date("2026-11-05T00:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

test("Telnyx: a fresh Ed25519 signature over timestamp|body passes", () => {
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: BODY,
    }),
    true,
  );
});

test("Telnyx: stale, tampered, re-serialised, wrongly keyed or unsigned deliveries are refused", () => {
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S - 301),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: BODY,
    }),
    false,
    "older than five minutes",
  );
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: `${BODY} `,
    }),
    false,
    "a byte changed",
  );
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: reserialised,
    }),
    false,
    "verified against a re-serialised body",
  );
  const other = generateKeyPairSync("ed25519");
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S, other.privateKey),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: BODY,
    }),
    false,
    "another account's key",
  );
  assert.equal(
    verifyTelnyxSignature({
      headers: new Headers(),
      now: NOW,
      publicKey: PUBLIC_KEY,
      rawBody: BODY,
    }),
    false,
  );
  assert.equal(
    verifyTelnyxSignature({
      headers: telnyxHeaders(BODY, NOW_S),
      now: NOW,
      publicKey: "not-a-key",
      rawBody: BODY,
    }),
    false,
    "a misconfigured key is never accept",
  );
});
