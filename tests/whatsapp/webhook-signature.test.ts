import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import { verifyWhatsAppSignature } from "@/lib/whatsapp/webhook-signature";

const SECRET = "app-secret";
const BODY = '{"object":"whatsapp_business_account","entry":[]}';

function signed(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function headers(signature?: string) {
  const result = new Headers();
  if (signature !== undefined) result.set("X-Hub-Signature-256", signature);
  return result;
}

test("a body signed with the app secret verifies", () => {
  assert.equal(
    verifyWhatsAppSignature(headers(signed(BODY)), BODY, SECRET),
    true,
  );
});

test("the hex digest is accepted in either case", () => {
  const upper = `sha256=${signed(BODY).slice("sha256=".length).toUpperCase()}`;
  assert.equal(verifyWhatsAppSignature(headers(upper), BODY, SECRET), true);
});

test("a changed body, a wrong secret or a re-serialised body does not verify", () => {
  assert.equal(
    verifyWhatsAppSignature(headers(signed(BODY)), `${BODY} `, SECRET),
    false,
  );
  assert.equal(
    verifyWhatsAppSignature(headers(signed(BODY, "other")), BODY, SECRET),
    false,
  );
  // The reason the route reads the raw text: JSON.stringify(JSON.parse(x))
  // is not x when the sender used different spacing.
  const spaced = '{ "object": "whatsapp_business_account", "entry": [] }';
  assert.equal(
    verifyWhatsAppSignature(
      headers(signed(spaced)),
      JSON.stringify(JSON.parse(spaced)),
      SECRET,
    ),
    false,
  );
});

test("it fails closed: no secret, no header, wrong prefix or a malformed digest", () => {
  assert.equal(verifyWhatsAppSignature(headers(signed(BODY)), BODY, ""), false);
  assert.equal(
    verifyWhatsAppSignature(headers(signed(BODY)), BODY, null),
    false,
  );
  assert.equal(verifyWhatsAppSignature(headers(), BODY, SECRET), false);
  assert.equal(
    verifyWhatsAppSignature(
      headers(signed(BODY).replace("sha256=", "sha1=")),
      BODY,
      SECRET,
    ),
    false,
  );
  assert.equal(
    verifyWhatsAppSignature(headers("sha256=abc"), BODY, SECRET),
    false,
  );
  assert.equal(
    verifyWhatsAppSignature(headers(`sha256=${"z".repeat(64)}`), BODY, SECRET),
    false,
  );
});
