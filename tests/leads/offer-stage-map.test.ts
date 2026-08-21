import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OFFER_STATUS_LEAD_STAGE,
  leadStagePatchForOfferStatus,
} from "../../lib/leads/offer-stage-map";
import { stageDef } from "../../lib/leads/pipeline-stages";

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
  // Pinned exactly, not just checked for OPEN. A decline sliding down to
  // QUALIFIED would still be open and would still pass the never-outranks
  // test below, because 40% is under QUOTED rather than over it.
  const EXPECTED = {
    OFFER_DECLINED: "QUOTED",
    REJECTED: "QUOTED",
    TENDER_DECLINED: "NEGOTIATING",
    CONTRACT_DECLINED: "NEGOTIATING",
  } as const;

  for (const [status, expected] of Object.entries(EXPECTED)) {
    const stage = OFFER_STATUS_LEAD_STAGE[status as keyof typeof EXPECTED];
    assert.equal(stage, expected, status);
    // And never a closing stage: that call carries a reason no status has.
    assert.equal(stageDef(stage!).outcome, "OPEN", status);
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

test("an early-stage offer moves a cold lead to Quoted", () => {
  // Was NEGOTIATING while every non-terminal status collapsed to that one
  // stage. A price in the customer's hands is Quoted, not a negotiation.
  const patch = leadStagePatchForOfferStatus("SENT", "NEW", NOW, null);
  assert.equal(patch?.stage, "QUOTED");
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

/* ── granularity, and the no-demote guard ──────────────────────────── */

test("the map never sends a later status to a lower stage", () => {
  // The invariant the whole split rests on. While everything mapped to
  // NEGOTIATING this held by accident; now it has to be checked.
  const SEQUENCE = [
    "PENDING", "SENT", "OFFER_SENT", "OFFER_SIGNED", "AGREED",
    "TENDER_DRAFT", "TENDER_SENT", "TENDER_SIGNED",
    "CONTRACT_DRAFT", "CONTRACT_SENT", "CONTRACT_SIGNED", "PROJECT",
  ] as const;

  let floor = 0;
  for (const status of SEQUENCE) {
    const stage = OFFER_STATUS_LEAD_STAGE[status];
    assert.ok(stage, `${status} should map somewhere`);
    const p = stageDef(stage!).probability;
    assert.ok(p >= floor, `${status} -> ${stage} (${p}%) drops below ${floor}%`);
    floor = p;
  }
});

test("a decline never outranks the paperwork it came from", () => {
  // The defect in the first draft of this map: leaving declines at NEGOTIATING
  // while lowering the live statuses meant a declined contract scored 70% and
  // one awaiting signature scored 55%. Saying no raised the forecast.
  for (const [live, declined] of [
    ["SENT", "REJECTED"],
    ["OFFER_SENT", "OFFER_DECLINED"],
    ["TENDER_SENT", "TENDER_DECLINED"],
    ["CONTRACT_SENT", "CONTRACT_DECLINED"],
  ] as const) {
    const livePct = stageDef(OFFER_STATUS_LEAD_STAGE[live]!).probability;
    const deadPct = stageDef(OFFER_STATUS_LEAD_STAGE[declined]!).probability;
    assert.ok(deadPct <= livePct, `${declined} (${deadPct}%) outranks ${live} (${livePct}%)`);
  }
});

test("an offer reset to PENDING does not demote a lead in negotiation", () => {
  // offer-workspace allows OFFER_DECLINED -> PENDING, so this is a real path,
  // not a hypothetical. Without the guard the lead drops 70% to 40%.
  assert.equal(leadStagePatchForOfferStatus("PENDING", "NEGOTIATING", NOW, null), null);
  assert.equal(leadStagePatchForOfferStatus("SENT", "NEGOTIATING", NOW, null), null);
});

test("a revise cycle does not bounce the stage", () => {
  // OFFER_SENT -> declined -> revised SENT -> declined again. Levelling the
  // decline with the status it follows makes the whole loop a no-op after the
  // first move, so the stage and the forecast sit still through every revision.
  const sent = leadStagePatchForOfferStatus("OFFER_SENT", "CONTACTED", NOW, null);
  assert.equal(sent?.stage, "QUOTED");
  assert.equal(leadStagePatchForOfferStatus("OFFER_DECLINED", "QUOTED", NOW, null), null);
  assert.equal(leadStagePatchForOfferStatus("SENT", "QUOTED", NOW, null), null);
  assert.equal(leadStagePatchForOfferStatus("OFFER_DECLINED", "QUOTED", NOW, null), null);
});

test("a stalled lead can still re-enter the pipeline", () => {
  // NO_RESPONSE sorts last by `order` but is worth nothing, which is why the
  // guard compares probability and only holds OPEN stages.
  const patch = leadStagePatchForOfferStatus("SENT", "NO_RESPONSE", NOW, null);
  assert.equal(patch?.stage, "QUOTED");
});

test("an early lead is advanced by offer activity", () => {
  assert.equal(leadStagePatchForOfferStatus("PENDING", "NEW", NOW, null)?.stage, "QUALIFIED");
  assert.equal(leadStagePatchForOfferStatus("SENT", "CONTACTED", NOW, null)?.stage, "QUOTED");
  assert.equal(
    leadStagePatchForOfferStatus("CONTRACT_SENT", "QUOTED", NOW, null)?.stage,
    "NEGOTIATING",
  );
});
