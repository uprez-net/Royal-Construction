import assert from "node:assert/strict";

import { OfferStatus } from "@prisma/client";
import { test } from "vitest";

import {
  canEmailOfferProposal,
  offerValidityIssue,
} from "@/lib/offer/offer-send-guards";
import { collectOfferSendBlockers } from "@/lib/offer/offer-readiness";

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

// #534: a blank validity date printed "firm until , subject to…" and a past one
// told the client the offer had lapsed.
test("a blank, malformed or past validity date is refused; today is fine", () => {
  const now = new Date("2026-11-20T02:00:00Z"); // 1pm, 20 Nov in Sydney
  assert.match(offerValidityIssue("", now) ?? "", /Set a validity date/);
  assert.match(offerValidityIssue("   ", now) ?? "", /Set a validity date/);
  assert.match(
    offerValidityIssue("20/11/2026", now) ?? "",
    /Set a validity date/,
  );
  assert.match(
    offerValidityIssue("2026-02-30", now) ?? "",
    /Set a validity date/,
  );
  assert.match(offerValidityIssue("2026-11-19", now) ?? "", /has passed/);
  assert.equal(offerValidityIssue("2026-11-20", now), null);
  assert.equal(offerValidityIssue("2027-01-31", now), null);
});

test("the date is judged on Sydney's clock, not the server's", () => {
  // 12:59 UTC is 23:59 on the 20th in Sydney; a minute later it is the 21st.
  assert.equal(
    offerValidityIssue("2026-11-20", new Date("2026-11-20T12:59:00Z")),
    null,
  );
  assert.match(
    offerValidityIssue("2026-11-20", new Date("2026-11-20T13:01:00Z")) ?? "",
    /has passed/,
  );
});

test("the readiness strip blocks on a missing or expired date, not on a valid one", () => {
  const base = {
    hasLead: true,
    hasKnownFloorArea: true,
    needsOverrideReason: false,
  };
  const ids = (expiryState: "none" | "valid" | "soon" | "expired") =>
    collectOfferSendBlockers({ ...base, expiryState }).map(
      (b) => `${b.severity}:${b.id}`,
    );
  assert.deepEqual(ids("none"), ["block:validity-missing"]);
  assert.deepEqual(ids("expired"), ["block:expired"]);
  assert.deepEqual(ids("valid"), []);
  assert.deepEqual(ids("soon"), []);
});
