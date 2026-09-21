import assert from "node:assert/strict";
import { test } from "node:test";

import { OfferStatus } from "@prisma/client";

import {
  canSendOfferForAcceptance,
  describeAcceptanceSendBlock,
} from "../../lib/offer/offer-acceptance-guard";

const ALL_STATUSES = Object.values(OfferStatus) as OfferStatus[];

test("SENT is the only status the acceptance send is allowed from", () => {
  // The safety property, stated on its own. This replaced a bare
  // `offerStatus !== SENT` check, and the whole risk of that swap is a map that
  // accidentally lets a second status through — which would put a second
  // DocuSign envelope in front of the customer for the same offer.
  const allowed = ALL_STATUSES.filter(canSendOfferForAcceptance);
  assert.deepEqual(allowed, [OfferStatus.SENT]);
});

test("the guard blocks exactly what the old !== SENT check blocked", () => {
  // Parity with the behaviour being replaced, status by status, so the change
  // is provably about wording and not about who may send.
  for (const status of ALL_STATUSES) {
    assert.equal(
      describeAcceptanceSendBlock(status) === null,
      status === OfferStatus.SENT,
      `${status} changed whether the send is allowed`,
    );
  }
});

test("every status has a decision, including any newly added one", () => {
  // Record<OfferStatus, …> makes tsc catch a missing member, but only while
  // the map is written as a literal. This catches it at runtime too, so a
  // status added to the enum can't reach an operator as `undefined`.
  for (const status of ALL_STATUSES) {
    const reason = describeAcceptanceSendBlock(status);
    assert.ok(
      reason === null || (typeof reason === "string" && reason.length > 0),
      `${status} has no decision`,
    );
  }
});

test("no blocked reason leaks a raw enum value at the operator", () => {
  // The bug this exists for. "current status: OFFER_SENT" denies its own
  // condition — the sentence says the offer must be sent to the client, and
  // the value it prints reads as exactly that.
  for (const status of ALL_STATUSES) {
    const reason = describeAcceptanceSendBlock(status);
    if (reason === null) continue;
    for (const value of ALL_STATUSES) {
      assert.ok(
        !reason.includes(value),
        `${status}'s message prints the raw enum ${value}`,
      );
    }
    assert.ok(
      !/_/.test(reason),
      `${status}'s message contains a SCREAMING_CASE token`,
    );
  }
});

test("every blocked reason names a way forward", () => {
  // A dead end sends the estimator to whoever built it. Each message has to
  // end in something they can do from the workspace they are already in.
  const NEXT_STEP =
    /email|create a revision|open the current revision|mark it agreed|send the tender|tender is|contract variation|handled on the contract|already out for signature/i;
  for (const status of ALL_STATUSES) {
    const reason = describeAcceptanceSendBlock(status);
    if (reason === null) continue;
    assert.match(
      reason,
      NEXT_STEP,
      `${status}: "${reason}" names no next step`,
    );
  }
});
