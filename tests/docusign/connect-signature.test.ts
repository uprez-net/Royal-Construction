import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import { verifyConnectSignature } from "@/lib/docusign/connect-signature";

const BODY = JSON.stringify({
  event: "envelope-completed",
  data: { envelopeId: "abc-123" },
});

const OLD_KEY = "old-secret-key-value";
const NEW_KEY = "new-secret-key-value";

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body, "utf8").digest("base64");
}

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

test("accepts a payload signed with the configured key in header -1", () => {
  assert.equal(
    verifyConnectSignature(
      headers({ "x-docusign-signature-1": sign(BODY, NEW_KEY) }),
      BODY,
      NEW_KEY,
    ),
    true,
  );
});

test("accepts the configured key's signature when it arrives in header -2", () => {
  // THE STAGING FAILURE. A second HMAC key was ADDED in DocuSign rather than
  // replacing the first, so DocuSign signed every callback with both keys:
  // -1 with the OLD key, -2 with the NEW one. The env var held the NEW key, and
  // reading only -1 meant every Connect callback 401'd — signature sync stopped,
  // tender/contract status stuck, executed PDFs never archived.
  const h = headers({
    "x-docusign-signature-1": sign(BODY, OLD_KEY),
    "x-docusign-signature-2": sign(BODY, NEW_KEY),
  });
  assert.equal(verifyConnectSignature(h, BODY, NEW_KEY), true);
});

test("accepts a match in a later header (-3), covering multi-key rotation", () => {
  const h = headers({
    "x-docusign-signature-1": sign(BODY, OLD_KEY),
    "x-docusign-signature-2": sign(BODY, "another-unrelated-key"),
    "x-docusign-signature-3": sign(BODY, NEW_KEY),
  });
  assert.equal(verifyConnectSignature(h, BODY, NEW_KEY), true);
});

test("rejects when NO presented signature matches the configured key", () => {
  const h = headers({
    "x-docusign-signature-1": sign(BODY, OLD_KEY),
    "x-docusign-signature-2": sign(BODY, "another-unrelated-key"),
  });
  assert.equal(verifyConnectSignature(h, BODY, NEW_KEY), false);
});

test("rejects when no signature header is present at all", () => {
  assert.equal(verifyConnectSignature(headers({}), BODY, NEW_KEY), false);
});

test("rejects a tampered body even with an otherwise valid signature", () => {
  // Authenticity, not just key possession: the signature is over the ORIGINAL
  // body, so a modified payload must fail.
  const h = headers({ "x-docusign-signature-1": sign(BODY, NEW_KEY) });
  const tampered = JSON.stringify({
    event: "envelope-completed",
    data: { envelopeId: "SOMEONE-ELSES-ENVELOPE" },
  });
  assert.equal(verifyConnectSignature(h, tampered, NEW_KEY), false);
});

test("rejects an empty configured key rather than accepting anything", () => {
  const h = headers({ "x-docusign-signature-1": sign(BODY, "") });
  assert.equal(verifyConnectSignature(h, BODY, ""), false);
});

test("ignores signature headers beyond the scanned bound", () => {
  // A caller cannot force unbounded comparisons by sending a long header run.
  const h = headers({ "x-docusign-signature-99": sign(BODY, NEW_KEY) });
  assert.equal(verifyConnectSignature(h, BODY, NEW_KEY), false);
});

test("a non-base64 / garbage signature does not throw", () => {
  const h = headers({ "x-docusign-signature-1": "!!!not-base64!!!" });
  assert.doesNotThrow(() => verifyConnectSignature(h, BODY, NEW_KEY));
  assert.equal(verifyConnectSignature(h, BODY, NEW_KEY), false);
});
