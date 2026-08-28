import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCertifierReplySubject,
  buildCertifierSubject,
  extractCertifierRefToken,
  generateCertifierRefToken,
} from "../../lib/graph/certifier-subject";
import { isMachineGenerated } from "../../lib/graph/offer-reply-classify";

const TOKEN = "RCCERT-A1B2C3D4E5F6";

test("the token is found through any number of reply prefixes", () => {
  for (const subject of [
    `[${TOKEN}] 14 Example St, Marrickville`,
    `Re: [${TOKEN}] 14 Example St, Marrickville`,
    `RE: [${TOKEN}] 14 Example St`,
    `Fw: Re: [${TOKEN}] 14 Example St`,
    `FW: RE: Re: [${TOKEN}] 14 Example St`,
    // Some clients drop the address and keep only the bracketed token.
    `Re: [${TOKEN}]`,
  ]) {
    assert.equal(extractCertifierRefToken(subject), TOKEN, subject);
  }
});

test("a lower-cased subject still resolves to the stored token", () => {
  // Stored refTokens are upper-case; a client that normalises the subject must
  // not silently orphan the whole thread.
  assert.equal(
    extractCertifierRefToken("re: [rccert-a1b2c3d4e5f6] 14 example st"),
    TOKEN,
  );
});

test("subjects without a well-formed token return null", () => {
  for (const subject of [
    "",
    null,
    undefined,
    "Re: your invoice",
    // The offer token, which must not be mistaken for a certifier one.
    "Your Building Proposal — RC-1042 [RCOFR-A1B2C3D4E5F6]",
    // Right prefix, wrong length.
    "[RCCERT-A1B2C3] 14 Example St",
    "[RCCERT-A1B2C3D4E5F6A] 14 Example St",
    // Unbracketed, so not a token we minted.
    "RCCERT-A1B2C3D4E5F6 14 Example St",
    // Non-hex.
    "[RCCERT-Z1B2C3D4E5F6] 14 Example St",
  ]) {
    assert.equal(extractCertifierRefToken(subject), null, String(subject));
  }
});

test("a bounce quoting the token is rejected before it reaches an engagement", () => {
  // The bounce carries the token, because a DSN quotes the original subject.
  // Correlation succeeding is the point — what stops it being treated as the
  // certifier replying is isMachineGenerated, not the subject.
  const subject = `Undeliverable: [${TOKEN}] 14 Example St`;
  assert.equal(extractCertifierRefToken(subject), TOKEN);

  assert.equal(isMachineGenerated({ autoSubmitted: "auto-replied" }), true);
  assert.equal(isMachineGenerated({ returnPath: "<>" }), true);
  assert.equal(
    isMachineGenerated({
      contentType: 'multipart/report; report-type=delivery-status',
    }),
    true,
  );
  // A genuine reply from the certifier's own client.
  assert.equal(isMachineGenerated({ autoSubmitted: "no" }), false);
  assert.equal(isMachineGenerated({}), false);
});

test("minted tokens round-trip through a built subject", () => {
  for (let i = 0; i < 50; i += 1) {
    const token = generateCertifierRefToken();
    const subject = buildCertifierSubject(token, "14 Example St, Marrickville");
    assert.equal(extractCertifierRefToken(subject), token);
    assert.equal(extractCertifierRefToken(buildCertifierReplySubject(subject)), token);
  }
});

test("the reply prefix is added once and never stacked", () => {
  const subject = buildCertifierSubject(TOKEN, "14 Example St");
  const once = buildCertifierReplySubject(subject);
  assert.equal(once, `Re: ${subject}`);
  // Replying to a reply must not produce "Re: Re: Re: …" over a long thread.
  assert.equal(buildCertifierReplySubject(once), once);
  assert.equal(buildCertifierReplySubject(`RE: ${subject}`), `RE: ${subject}`);
});
