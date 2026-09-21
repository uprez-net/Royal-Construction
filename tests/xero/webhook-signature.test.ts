import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { verifyXeroSignature } from "../../lib/xero/webhook-signature";

const KEY = "xero-webhook-signing-key";
const OTHER_KEY = "a-different-signing-key";

const BODY = JSON.stringify({
  events: [
    {
      resourceId: "b1c2d3e4-0000-4000-8000-000000000001",
      eventCategory: "INVOICE",
      eventType: "UPDATE",
    },
  ],
  firstEventSequence: 1,
  lastEventSequence: 1,
});

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body, "utf8").digest("base64");
}

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

test("accepts a payload signed with the configured key", () => {
  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": sign(BODY, KEY) }),
      BODY,
      KEY,
    ),
    true,
  );
});

test("rejects a payload signed with a different key", () => {
  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": sign(BODY, OTHER_KEY) }),
      BODY,
      KEY,
    ),
    false,
  );
});

// Xero's Intent To Receive check sends a deliberately mis-signed payload and
// requires a 401, so a tampered body must not verify.
test("rejects a body that was altered after signing", () => {
  const signature = sign(BODY, KEY);
  const tampered = BODY.replace("INVOICE", "CONTACT");

  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": signature }),
      tampered,
      KEY,
    ),
    false,
  );
});

test("rejects a request carrying no signature header", () => {
  assert.equal(verifyXeroSignature(headers({}), BODY, KEY), false);
});

// timingSafeEqual throws on a length mismatch, so a short or truncated
// signature has to be caught by the length check rather than blowing up.
test("rejects a truncated signature without throwing", () => {
  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": sign(BODY, KEY).slice(0, 10) }),
      BODY,
      KEY,
    ),
    false,
  );
});

test("rejects everything when no key is configured", () => {
  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": sign(BODY, "") }),
      BODY,
      "",
    ),
    false,
  );
});

// An empty events array is a normal delivery — it is what Intent To Receive
// sends — so an empty body still has to verify correctly.
test("verifies an empty payload", () => {
  const empty = JSON.stringify({ events: [] });

  assert.equal(
    verifyXeroSignature(
      headers({ "x-xero-signature": sign(empty, KEY) }),
      empty,
      KEY,
    ),
    true,
  );
});
