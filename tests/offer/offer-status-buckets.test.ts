import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfferStatus } from "@prisma/client";

import { OFFER_STATUS_BUCKETS } from "../../lib/offer/offer-status-buckets";
import { OfferStatusLabels } from "../../types/offer";

// The tab filter and the KPI query kept separate status lists, and neither had
// OFFER_SENT or OFFER_SIGNED (ADR 0004). A lead whose acceptance was out for
// signature, or already signed, dropped out of every tab and KPI card except
// the total. Both now read OFFER_STATUS_BUCKETS.

// OfferStatusLabels is a Record<OfferStatus, string>, so its keys are every
// status, and a status added to the enum without a label fails to compile.
const ALL_STATUSES = Object.keys(OfferStatusLabels) as OfferStatus[];

const bucketsOf = (status: OfferStatus) =>
  Object.entries(OFFER_STATUS_BUCKETS)
    .filter(([, statuses]) => statuses.includes(status))
    .map(([bucket]) => bucket);

test("every status except SUPERSEDED lands in at least one bucket", () => {
  for (const status of ALL_STATUSES) {
    if (status === "SUPERSEDED") continue;
    assert.notDeepEqual(bucketsOf(status), [], `${status} is in no bucket`);
  }
});

test("OFFER_SIGNED is approved and OFFER_SENT is sent", () => {
  assert.ok(OFFER_STATUS_BUCKETS.approved.includes("OFFER_SIGNED"));
  assert.ok(OFFER_STATUS_BUCKETS.sent.includes("OFFER_SENT"));
});

test("PENDING is only in pending", () => {
  assert.deepEqual(bucketsOf("PENDING"), ["pending"]);
});

test("every declined status and REJECTED are rejected, never approved", () => {
  const declined = ALL_STATUSES.filter(
    (status) => status.endsWith("_DECLINED") || status === "REJECTED",
  );
  assert.ok(declined.length >= 4);
  for (const status of declined) {
    assert.ok(OFFER_STATUS_BUCKETS.rejected.includes(status), `${status} not rejected`);
    assert.ok(!OFFER_STATUS_BUCKETS.approved.includes(status), `${status} approved`);
  }
});
