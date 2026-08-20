import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OFFER_STATUS_LEAD_STAGE,
  leadStagePatchForOfferStatus,
} from "../../lib/leads/offer-stage-map";

const NOW = new Date("2026-08-19T00:00:00.000Z");

const ALL_STATUSES = [
  "PENDING", "SENT", "ACCEPTED", "REJECTED", "OFFER_SENT", "OFFER_SIGNED",
  "OFFER_DECLINED", "AGREED", "TENDER_DRAFT", "TENDER_SENT", "TENDER_SIGNED",
  "TENDER_DECLINED", "CONTRACT_DRAFT", "CONTRACT_SENT", "CONTRACT_SIGNED",
  "CONTRACT_DECLINED", "PROJECT", "SUPERSEDED",
] as const;

test("every OfferStatus has a mapping", () => {
  for (const s of ALL_STATUSES) {
    assert.ok(s in OFFER_STATUS_LEAD_STAGE, `missing mapping for ${s}`);
  }
  assert.equal(Object.keys(OFFER_STATUS_LEAD_STAGE).length, ALL_STATUSES.length);
});

test("signing the contract wins the deal and stamps wonAt", () => {
  // CONVERTED, not WON: it is the same outcome, and the only one of the two
  // the stage picker offers. Writing WON would leave a badge on the lead that
  // an operator can neither reproduce nor undo.
  const patch = leadStagePatchForOfferStatus("CONTRACT_SIGNED", "NEGOTIATING", NOW, null);
  assert.deepEqual(patch, { stage: "CONVERTED", wonAt: NOW, lostAt: null });
});

test("starting the project keeps it won without re-dating the win", () => {
  // Already won from CONTRACT_SIGNED; PROJECT must not re-stamp.
  const won = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(leadStagePatchForOfferStatus("PROJECT", "CONVERTED", NOW, won), null);
});

test("a lead already won under the other name is left where it is", () => {
  // WON and CONVERTED are the same outcome. Rows carrying WON — older data, or
  // a sync from before this change — must not be shuffled to CONVERTED just
  // because a later offer event arrives; that would rewrite history's badges.
  const won = new Date("2026-01-01T00:00:00.000Z");
  for (const s of ["CONTRACT_SIGNED", "PROJECT", "ACCEPTED"] as const) {
    assert.equal(leadStagePatchForOfferStatus(s, "WON", NOW, won), null, s);
  }
});

test("a won deal is never reopened by a late or replayed earlier event", () => {
  for (const s of ["CONTRACT_SENT", "TENDER_SENT", "AGREED", "SENT", "PENDING"] as const) {
    assert.equal(
      leadStagePatchForOfferStatus(s, "WON", NOW, NOW),
      null,
      `${s} must not un-win a signed deal`,
    );
  }
});

test("no offer status can mark a lead lost", () => {
  // Closing a lead requires a recorded reason, which no offer status carries.
  for (const s of ALL_STATUSES) {
    const patch = leadStagePatchForOfferStatus(s, "NEGOTIATING", NOW, null);
    assert.notEqual(patch?.stage, "LOST", `${s} must not map to LOST`);
    assert.notEqual(patch?.stage, "CANCELLED", `${s} must not map to CANCELLED`);
    assert.notEqual(patch?.stage, "DISQUALIFIED", `${s} must not map to DISQUALIFIED`);
  }
});

test("a human's explicit loss is never overruled by offer activity", () => {
  for (const closed of ["LOST", "CANCELLED", "DISQUALIFIED"] as const) {
    for (const s of ["CONTRACT_SIGNED", "AGREED", "PROJECT"] as const) {
      assert.equal(
        leadStagePatchForOfferStatus(s, closed, NOW, null),
        null,
        `${s} must not move a ${closed} lead`,
      );
    }
  }
});

test("declines keep the deal open rather than closing it", () => {
  for (const s of ["OFFER_DECLINED", "TENDER_DECLINED", "CONTRACT_DECLINED", "REJECTED"] as const) {
    assert.equal(OFFER_STATUS_LEAD_STAGE[s], "NEGOTIATING", s);
  }
});

test("a superseded offer says nothing about the lead", () => {
  assert.equal(OFFER_STATUS_LEAD_STAGE.SUPERSEDED, null);
  for (const stage of ["NEW", "NEGOTIATING", "WON"] as const) {
    assert.equal(leadStagePatchForOfferStatus("SUPERSEDED", stage, NOW, null), null);
  }
});

test("applying the same status twice is a no-op", () => {
  // This is what makes a replayed DocuSign webhook safe without a dedupe table.
  const first = leadStagePatchForOfferStatus("CONTRACT_SIGNED", "NEGOTIATING", NOW, null);
  assert.ok(first);
  const second = leadStagePatchForOfferStatus(
    "CONTRACT_SIGNED", first.stage, NOW, first.wonAt ?? null,
  );
  assert.equal(second, null);
});

test("an early-stage offer moves a cold lead into negotiating", () => {
  const patch = leadStagePatchForOfferStatus("SENT", "NEW", NOW, null);
  assert.equal(patch?.stage, "NEGOTIATING");
});

test("a null current stage is tolerated", () => {
  const patch = leadStagePatchForOfferStatus("CONTRACT_SIGNED", null, NOW, null);
  assert.equal(patch?.stage, "CONVERTED");
});

test("a legacy converted lead with no wonAt gets one when its contract signs", () => {
  // CONVERTED pre-dates the wonAt column. The stage does not move, so
  // closeDatePatch stamps nothing, and the lead stays invisible to win rate.
  const patch = leadStagePatchForOfferStatus("CONTRACT_SIGNED", "CONVERTED", NOW, null);
  assert.equal(patch?.stage, "CONVERTED");
  assert.equal(patch?.wonAt?.toISOString(), NOW.toISOString());
});

test("an existing wonAt is never re-dated", () => {
  const original = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    leadStagePatchForOfferStatus("CONTRACT_SIGNED", "CONVERTED", NOW, original),
    null,
    "must not overwrite the original win date",
  );
});

test("no won stage is ever produced without a wonAt", () => {
  // The invariant the whole forecast rests on.
  for (const s of ALL_STATUSES) {
    for (const from of ["NEW", "NEGOTIATING", "QUOTED", "CONVERTED", "WON", null] as const) {
      const patch = leadStagePatchForOfferStatus(s, from, NOW, null);
      if (patch && (patch.stage === "WON" || patch.stage === "CONVERTED")) {
        assert.ok(patch.wonAt, `${from} -> ${s} produced a won stage with no wonAt`);
      }
    }
  }
});
