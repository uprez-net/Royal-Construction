import assert from "node:assert/strict";
import { test } from "vitest";
import {
  extractOfferReplyToken,
  isDeliveryFailure,
  isMachineGenerated,
} from "@/lib/graph/offer-reply-classify";

const TOKEN = "RCOFR-A1B2C3D4E5F6";
const SUBJECT = `Your Building Proposal — RC-Q-2026-015-R1 [${TOKEN}]`;

test("the token survives the prefixes Exchange puts on machine mail", () => {
  // This is the whole reason a sender/header guard is needed: correlation
  // works just as well for a bounce as for a real reply.
  assert.equal(extractOfferReplyToken(SUBJECT), TOKEN);
  assert.equal(extractOfferReplyToken(`Re: ${SUBJECT}`), TOKEN);
  assert.equal(extractOfferReplyToken(`Undeliverable: ${SUBJECT}`), TOKEN);
  assert.equal(extractOfferReplyToken(`Automatic reply: ${SUBJECT}`), TOKEN);
  assert.equal(extractOfferReplyToken(`FW: ${SUBJECT}`), TOKEN);
});

test("lowercase hex is normalised, and unrelated mail yields nothing", () => {
  // Only the hex digits are case-insensitive; the "RCOFR-" prefix is a literal.
  assert.equal(
    extractOfferReplyToken("Re: proposal [RCOFR-a1b2c3d4e5f6]"),
    TOKEN,
  );
  assert.equal(
    extractOfferReplyToken("Re: proposal [rcofr-a1b2c3d4e5f6]"),
    null,
  );
  assert.equal(extractOfferReplyToken("Re: your quote"), null);
  assert.equal(extractOfferReplyToken(""), null);
  assert.equal(extractOfferReplyToken(undefined), null);
  // Wrong length must not match: the token is exactly 12 hex characters.
  assert.equal(extractOfferReplyToken("[RCOFR-A1B2C3]"), null);
});

test("a genuine human reply is not treated as machine mail", () => {
  assert.equal(isMachineGenerated({}), false);
  assert.equal(
    isMachineGenerated({
      from: "client@example.com",
      returnPath: "<client@example.com>",
      contentType: 'multipart/alternative; boundary="_000_"',
    }),
    false,
  );
  // RFC 3834 allows an explicit "no" on human mail.
  assert.equal(isMachineGenerated({ autoSubmitted: "no" }), false);
});

test("a delivery status notification is machine mail", () => {
  // The empty return path is the RFC 3464 marker.
  assert.equal(isMachineGenerated({ returnPath: "<>" }), true);
  assert.equal(isMachineGenerated({ returnPath: " < > " }), true);
  assert.equal(
    isMachineGenerated({
      contentType:
        'multipart/report; report-type=delivery-status; boundary="_004_"',
    }),
    true,
  );
  assert.equal(isMachineGenerated({ autoSubmitted: "auto-replied" }), true);
  assert.equal(isMachineGenerated({ autoSubmitted: "auto-generated" }), true);
  assert.equal(isMachineGenerated({ autoSubmitted: "  Auto-Replied  " }), true);
});

test("an out-of-office is machine mail even though it comes from the client", () => {
  // The sender check alone would let this through, since the address matches
  // the one we sent to. Only the header betrays it.
  assert.equal(
    isMachineGenerated({
      from: "client@example.com",
      autoSubmitted: "auto-replied",
      returnPath: "<client@example.com>",
    }),
    true,
  );
});

test("absent headers mean no signal, not a verdict", () => {
  // Graph omits internetMessageHeaders on some messages. Defaulting to "not
  // machine-generated" keeps the sender comparison as the deciding guard,
  // rather than silently classifying every header-less message as a bounce.
  assert.equal(isMachineGenerated({}), false);
  assert.equal(isMachineGenerated({ from: "client@example.com" }), false);
});

// #585: the headers Graph returned for two real Exchange Online bounces on
// 5 Nov 2026. The report type is dropped and Return-Path is absent, so only
// the multipart/report content type separates them from an out-of-office reply.
test("a real bounce is a delivery failure; an out-of-office reply is not", () => {
  const bounce = {
    autoSubmitted: "auto-replied",
    contentType: "multipart/report",
  };
  assert.equal(isMachineGenerated(bounce), true);
  assert.equal(isDeliveryFailure(bounce), true);

  const outOfOffice = {
    autoSubmitted: "auto-replied",
    contentType: "text/plain; charset=utf-8",
    returnPath: "<>",
  };
  assert.equal(isMachineGenerated(outOfOffice), true);
  assert.equal(isDeliveryFailure(outOfOffice), false);
});

test("a full delivery-status content type counts; no signal does not", () => {
  assert.equal(
    isDeliveryFailure({
      contentType: "multipart/report; report-type=delivery-status",
    }),
    true,
  );
  assert.equal(isDeliveryFailure({}), false);
  assert.equal(
    isDeliveryFailure({ contentType: "multipart/alternative" }),
    false,
  );
});
