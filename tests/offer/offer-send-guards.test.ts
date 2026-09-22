import assert from "node:assert/strict";

import { OfferStatus } from "@prisma/client";
import { test } from "vitest";

import { canEmailOfferProposal } from "@/lib/offer/offer-send-guards";

// sendOfferDocument emailed the proposal from any status. An AGREED offer, one
// out for signature, or a superseded revision could be emailed again, quoting a
// workspace the Tender or Contract no longer matched.

const ALL_STATUSES = Object.values(OfferStatus) as OfferStatus[];

test("the proposal can be emailed only while pending or sent", () => {
  assert.deepEqual(
    ALL_STATUSES.filter(canEmailOfferProposal).sort(),
    [OfferStatus.PENDING, OfferStatus.SENT].sort(),
  );
});

test("an agreed, signing or superseded offer is refused", () => {
  for (const status of [
    OfferStatus.AGREED,
    OfferStatus.OFFER_SENT,
    OfferStatus.TENDER_SENT,
    OfferStatus.SUPERSEDED,
  ]) {
    assert.equal(canEmailOfferProposal(status), false, `${status} allowed`);
  }
});
