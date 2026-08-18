import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HBCF_DEFAULT_PROJECTION_MONTHS,
  hbcfAssessment,
  hbcfAxisRange,
  hbcfClaimColour,
  hbcfClaimLabel,
  hbcfNeedRange,
  hbcfProjectionMonths,
  type HbcfProjectClaim,
} from "../../lib/insurance/hbcf";

const TODAY = new Date(2026, 7, 18); // 18 Aug 2026, local.

function claim(
  overrides: Partial<HbcfProjectClaim> & Pick<HbcfProjectClaim, "projectId">,
): HbcfProjectClaim {
  return {
    projectName: `${overrides.projectId} project`,
    leadName: null,
    insuranceClaimStartDate: "2026-01-01",
    insuranceClaimEndDate: "2027-01-01",
    claimAmount: 100_000,
    ...overrides,
  };
}

/* ── Need range ─────────────────────────────────────────────────────────── */

test("a recorded deal value wins over the budget bracket and becomes a band", () => {
  const range = hbcfNeedRange({
    estimatedValue: 300_000,
    budget: "$500K - $700K",
  });

  assert.deepEqual(range, {
    low: 270_000,
    high: 330_000,
    source: "estimatedValue",
    isOpenEnded: false,
  });
});

test("the budget bracket is the fallback, used as the range it already is", () => {
  assert.deepEqual(hbcfNeedRange({ estimatedValue: null, budget: "$350K - $500K" }), {
    low: 350_000,
    high: 500_000,
    source: "budgetBracket",
    isOpenEnded: false,
  });

  // The top bracket's ceiling is a display cap, and says so.
  assert.equal(hbcfNeedRange({ budget: "$700K+" })?.isOpenEnded, true);
});

test("an unpriced lead with no readable bracket has no range at all", () => {
  assert.equal(hbcfNeedRange({ estimatedValue: null, budget: "Not Discussed" }), null);
  assert.equal(hbcfNeedRange({ estimatedValue: 0, budget: null }), null);
  assert.equal(hbcfNeedRange({}), null);
});

/* ── Assessment ─────────────────────────────────────────────────────────── */

test("free capacity covering the top of the range means the build can start now", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 200_000 })],
    needRange: { low: 250_000, high: 350_000, source: "budgetBracket", isOpenEnded: false },
    today: TODAY,
  });

  assert.equal(result.usedAmount, 200_000);
  assert.equal(result.directAvailable, 600_000);
  assert.equal(result.sufficient, true);
  assert.equal(result.decisiveClaim, null);
  assert.equal(result.canStartFrom, "2026-08-18");
  assert.equal(result.projectedWindow?.start, "2026-08-18");
});

test("the decisive claim is the expiry that tips capacity over the top of the range", () => {
  // $100K free, needing up to $350K. Smith frees $250K first and clears it;
  // Chen's later expiry is never reached.
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "smith",
        leadName: "Smith",
        claimAmount: 250_000,
        insuranceClaimEndDate: "2026-11-30",
      }),
      claim({
        projectId: "chen",
        leadName: "Chen",
        claimAmount: 300_000,
        insuranceClaimEndDate: "2027-03-31",
      }),
      claim({
        projectId: "johnson",
        leadName: "Johnson",
        claimAmount: 150_000,
        insuranceClaimEndDate: "2027-06-30",
      }),
    ],
    needRange: { low: 250_000, high: 350_000, source: "budgetBracket", isOpenEnded: false },
    today: TODAY,
  });

  assert.equal(result.usedAmount, 700_000);
  assert.equal(result.directAvailable, 100_000);
  assert.equal(result.sufficient, false);
  assert.equal(result.decisiveClaim?.label, "Smith");
  assert.equal(result.decisiveClaim?.claimAmount, 250_000);
  assert.equal(result.decisiveClaim?.freesOn, "2026-11-30");
  assert.equal(result.canStartFrom, "2026-11-30");
});

test("expiries are walked in date order, not the order they arrive in", () => {
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "late",
        leadName: "Late",
        claimAmount: 400_000,
        insuranceClaimEndDate: "2027-09-30",
      }),
      claim({
        projectId: "early",
        leadName: "Early",
        claimAmount: 380_000,
        insuranceClaimEndDate: "2026-10-01",
      }),
    ],
    needRange: { low: 380_000, high: 400_000, source: "budgetBracket", isOpenEnded: false },
    today: TODAY,
  });

  assert.equal(result.decisiveClaim?.label, "Early");
  assert.equal(result.canStartFrom, "2026-10-01");
});

test("when one expiry is not enough, the decisive one is where the running total crosses", () => {
  // $0 free, needing $400K. The first expiry frees $150K (short), the second
  // takes the running total to $450K.
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "first",
        leadName: "First",
        claimAmount: 150_000,
        insuranceClaimEndDate: "2026-10-01",
      }),
      claim({
        projectId: "second",
        leadName: "Second",
        claimAmount: 300_000,
        insuranceClaimEndDate: "2027-02-01",
      }),
      claim({
        projectId: "third",
        leadName: "Third",
        claimAmount: 350_000,
        insuranceClaimEndDate: "2027-05-01",
      }),
    ],
    needRange: { low: 350_000, high: 400_000, source: "budgetBracket", isOpenEnded: false },
    today: TODAY,
  });

  assert.equal(result.directAvailable, 0);
  assert.equal(result.decisiveClaim?.label, "Second");
  assert.equal(result.canStartFrom, "2027-02-01");
});

test("already-lapsed cover cannot free anything a second time", () => {
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "lapsed",
        claimAmount: 500_000,
        insuranceClaimStartDate: "2024-01-01",
        insuranceClaimEndDate: "2025-01-01",
      }),
    ],
    needRange: { low: 700_000, high: 800_000, source: "budgetBracket", isOpenEnded: false },
    today: TODAY,
  });

  // $300K free now; the lapsed claim is behind us so nothing more frees up.
  assert.equal(result.directAvailable, 300_000);
  assert.equal(result.decisiveClaim, null);
  assert.equal(result.canStartFrom, null);
  assert.equal(result.projectedWindow, null);
});

test("a build the whole pool cannot carry reports no start date rather than a guess", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 200_000 })],
    needRange: { low: 900_000, high: 1_200_000, source: "budgetBracket", isOpenEnded: true },
    today: TODAY,
  });

  assert.equal(result.sufficient, false);
  assert.equal(result.decisiveClaim, null);
  assert.equal(result.canStartFrom, null);
  assert.equal(result.projectedWindow, null);
});

test("an unpriced lead still reports capacity, but no start date", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 250_000 })],
    needRange: null,
    today: TODAY,
  });

  assert.equal(result.usedAmount, 250_000);
  assert.equal(result.directAvailable, 550_000);
  assert.equal(result.needRange, null);
  assert.equal(result.canStartFrom, null);
  assert.equal(result.projectedWindow, null);
});

test("over-committed capacity floors at zero rather than going negative", () => {
  const result = hbcfAssessment({
    claims: [
      claim({ projectId: "a", claimAmount: 600_000 }),
      claim({ projectId: "b", claimAmount: 400_000 }),
    ],
    needRange: null,
    today: TODAY,
  });

  assert.equal(result.usedAmount, 1_000_000);
  assert.equal(result.directAvailable, 0);
});

/* ── Projection and axis ────────────────────────────────────────────────── */

test("the projection length is the mean of the cover windows already on the books", () => {
  const months = hbcfProjectionMonths([
    claim({
      projectId: "a",
      insuranceClaimStartDate: "2026-01-01",
      insuranceClaimEndDate: "2026-07-01",
    }),
    claim({
      projectId: "b",
      insuranceClaimStartDate: "2026-01-01",
      insuranceClaimEndDate: "2027-01-01",
    }),
  ]);

  assert.equal(months, 9);
  assert.equal(hbcfProjectionMonths([]), HBCF_DEFAULT_PROJECTION_MONTHS);
});

test("the axis spans every claim, today, and the projection, on month boundaries", () => {
  const axis = hbcfAxisRange({
    claims: [
      claim({
        projectId: "a",
        insuranceClaimStartDate: "2026-03-15",
        insuranceClaimEndDate: "2026-12-20",
      }),
    ],
    projectedWindow: { start: "2026-12-20", end: "2027-06-20" },
    today: TODAY,
  });

  assert.equal(axis.start.getFullYear(), 2026);
  assert.equal(axis.start.getMonth(), 2); // March, snapped to the 1st
  assert.equal(axis.start.getDate(), 1);
  // A month of tail padding past the projection's end.
  assert.equal(axis.end.getFullYear(), 2027);
  assert.equal(axis.end.getMonth(), 6); // July
});

/* ── Presentation helpers ───────────────────────────────────────────────── */

test("the lead name is the label, falling back to the long project name", () => {
  assert.equal(
    hbcfClaimLabel(claim({ projectId: "a", leadName: "Smith", projectName: "Smith — 1 St" })),
    "Smith",
  );
  assert.equal(
    hbcfClaimLabel(claim({ projectId: "a", leadName: "  ", projectName: "Chen — 2 St" })),
    "Chen — 2 St",
  );
});

test("colours are assigned stably and wrap past the end of the palette", () => {
  assert.equal(hbcfClaimColour(0), hbcfClaimColour(0));
  assert.notEqual(hbcfClaimColour(0), hbcfClaimColour(1));
  assert.equal(hbcfClaimColour(0), hbcfClaimColour(5));
});
