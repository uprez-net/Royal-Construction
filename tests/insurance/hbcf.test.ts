import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HBCF_DEFAULT_PROJECTION_MONTHS,
  HBCF_TOTAL_SUM_ASSURED,
  hbcfAssessment,
  hbcfAxisRange,
  hbcfClaimColour,
  hbcfClaimLabel,
  hbcfIsActiveOn,
  hbcfNeedRange,
  hbcfProjectionMonths,
  hbcfUsedAt,
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
  assert.deepEqual(
    hbcfNeedRange({
      estimatedValue: null,
      budget: "$350K - $500K",
    }),
    {
      low: 350_000,
      high: 500_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
  );

  // The top bracket's ceiling is a display cap, and says so.
  assert.equal(
    hbcfNeedRange({ budget: "$700K+" })?.isOpenEnded,
    true,
  );
});

test("an unpriced lead with no readable bracket has no range at all", () => {
  assert.equal(
    hbcfNeedRange({
      estimatedValue: null,
      budget: "Not Discussed",
    }),
    null,
  );

  assert.equal(
    hbcfNeedRange({
      estimatedValue: 0,
      budget: null,
    }),
    null,
  );

  assert.equal(hbcfNeedRange({}), null);
});

/* ── Claim activity ─────────────────────────────────────────────────────── */

test("a claim is active when the date falls inside its cover window", () => {
  const project = claim({
    projectId: "active",
    insuranceClaimStartDate: "2026-08-01",
    insuranceClaimEndDate: "2026-08-31",
  });

  assert.equal(hbcfIsActiveOn(project, new Date(2026, 7, 1)), true);
  assert.equal(hbcfIsActiveOn(project, TODAY), true);
  assert.equal(hbcfIsActiveOn(project, new Date(2026, 7, 31)), true);
});

test("a claim is inactive before its start date and after its end date", () => {
  const project = claim({
    projectId: "window",
    insuranceClaimStartDate: "2026-08-01",
    insuranceClaimEndDate: "2026-08-31",
  });

  assert.equal(hbcfIsActiveOn(project, new Date(2026, 6, 31)), false);
  assert.equal(hbcfIsActiveOn(project, new Date(2026, 8, 1)), false);
});

test("hbcfUsedAt only counts claims active on the requested date", () => {
  const claims = [
    claim({
      projectId: "active",
      claimAmount: 200_000,
      insuranceClaimStartDate: "2026-01-01",
      insuranceClaimEndDate: "2026-12-31",
    }),
    claim({
      projectId: "lapsed",
      claimAmount: 300_000,
      insuranceClaimStartDate: "2025-01-01",
      insuranceClaimEndDate: "2026-01-01",
    }),
    claim({
      projectId: "future",
      claimAmount: 400_000,
      insuranceClaimStartDate: "2026-09-01",
      insuranceClaimEndDate: "2027-01-01",
    }),
  ];

  assert.equal(
    hbcfUsedAt(claims, TODAY),
    200_000,
  );

  assert.equal(
    hbcfUsedAt(claims, new Date(2026, 8, 15)),
    600_000,
  );
});

/* ── Assessment ─────────────────────────────────────────────────────────── */

test("free capacity covering the top of the range means the build can start now", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 200_000 })],
    needRange: {
      low: 250_000,
      high: 350_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  assert.equal(result.totalSumAssured, 800_000);
  assert.equal(result.usedAmount, 200_000);
  assert.equal(result.directAvailable, 600_000);
  assert.equal(result.sufficient, true);
  assert.equal(result.decisiveClaim, null);
  assert.equal(result.canStartFrom, "2026-08-18");
  assert.equal(result.projectedWindow?.start, "2026-08-18");
});

test("the decisive claim is the expiry that tips capacity over the top of the range", () => {
  // $100K free, needing up to $350K.
  // Smith frees $250K first and clears it.
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
    needRange: {
      low: 250_000,
      high: 350_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  assert.equal(result.usedAmount, 700_000);
  assert.equal(result.directAvailable, 100_000);
  assert.equal(result.sufficient, false);
  assert.equal(result.decisiveClaim?.label, "Smith");
  assert.equal(result.decisiveClaim?.claimAmount, 250_000);
  assert.equal(result.decisiveClaim?.freesOn, "2026-11-30");
  assert.equal(result.canStartFrom, "2026-11-30");
  assert.equal(result.projectedWindow?.start, "2026-11-30");
});

test("expiries are walked in date order, not the order they arrive in", () => {
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "late",
        leadName: "Late",
        claimAmount: 380_000,
        insuranceClaimEndDate: "2027-09-30",
      }),
      claim({
        projectId: "early",
        leadName: "Early",
        claimAmount: 400_000,
        insuranceClaimEndDate: "2026-10-01",
      }),
    ],
    needRange: {
      low: 380_000,
      high: 400_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 780_000,
  });

  assert.equal(result.usedAmount, 780_000);
  assert.equal(result.directAvailable, 0);
  assert.equal(result.decisiveClaim?.label, "Early");
  assert.equal(result.canStartFrom, "2026-10-01");
});

test("when one expiry is not enough, the decisive one is where the running total crosses", () => {
  // $0 free, needing $400K.
  // First expiry frees $150K.
  // Second expiry takes the running total to $450K.
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
    needRange: {
      low: 350_000,
      high: 400_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  assert.equal(result.directAvailable, 0);
  assert.equal(result.decisiveClaim?.label, "Second");
  assert.equal(result.canStartFrom, "2027-02-01");
  assert.equal(result.projectedWindow?.start, "2027-02-01");
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
    needRange: {
      low: 700_000,
      high: 800_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  assert.equal(result.directAvailable, 300_000);
  assert.equal(result.decisiveClaim, null);
  assert.equal(result.canStartFrom, null);
  assert.equal(result.projectedWindow, null);
});

test("a build the whole pool cannot carry reports no start date rather than a guess", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 200_000 })],
    needRange: {
      low: 900_000,
      high: 1_200_000,
      source: "budgetBracket",
      isOpenEnded: true,
    },
    today: TODAY,
    totalSumAssured: 800_000,
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
    totalSumAssured: 800_000,
  });

  assert.equal(result.totalSumAssured, 800_000);
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
    totalSumAssured: 800_000,
  });

  assert.equal(result.usedAmount, 1_000_000);
  assert.equal(result.directAvailable, 0);
});

test("the default total sum assured is the 8 million product capacity", () => {
  const result = hbcfAssessment({
    claims: [claim({ projectId: "a", claimAmount: 200_000 })],
    needRange: null,
    today: TODAY,
  });

  assert.equal(result.totalSumAssured, HBCF_TOTAL_SUM_ASSURED);
  assert.equal(result.directAvailable, 7_800_000);
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
  assert.equal(
    hbcfProjectionMonths([]),
    HBCF_DEFAULT_PROJECTION_MONTHS,
  );
});

test("projection months are clamped to the minimum bound", () => {
  const months = hbcfProjectionMonths([
    claim({
      projectId: "a",
      insuranceClaimStartDate: "2026-01-01",
      insuranceClaimEndDate: "2026-02-01",
    }),
  ]);

  assert.equal(months, 3);
});

test("projection months are clamped to the maximum bound", () => {
  const months = hbcfProjectionMonths([
    claim({
      projectId: "a",
      insuranceClaimStartDate: "2020-01-01",
      insuranceClaimEndDate: "2030-01-01",
    }),
  ]);

  assert.equal(months, 36);
});

test("invalid or zero-length cover windows fall back to the default projection", () => {
  assert.equal(
    hbcfProjectionMonths([
      claim({
        projectId: "zero",
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-01-01",
      }),
    ]),
    HBCF_DEFAULT_PROJECTION_MONTHS,
  );
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
    projectedWindow: {
      start: "2026-12-20",
      end: "2027-06-20",
    },
    today: TODAY,
  });

  assert.equal(axis.start.getFullYear(), 2026);
  assert.equal(axis.start.getMonth(), 2); // March
  assert.equal(axis.start.getDate(), 1);

  // End of the month after the projection's end.
  assert.equal(axis.end.getFullYear(), 2027);
  assert.equal(axis.end.getMonth(), 6); // July
  assert.equal(axis.end.getDate(), 31);
});

test("the axis still includes today when there are no claims or projection", () => {
  const axis = hbcfAxisRange({
    claims: [],
    projectedWindow: null,
    today: TODAY,
  });

  assert.equal(axis.start.getFullYear(), 2026);
  assert.equal(axis.start.getMonth(), 7); // August
  assert.equal(axis.start.getDate(), 1);

  assert.equal(axis.end.getFullYear(), 2026);
  assert.equal(axis.end.getMonth(), 8); // September
  assert.equal(axis.end.getDate(), 30);
});

/* ── Presentation helpers ───────────────────────────────────────────────── */

test("the lead name is the label, falling back to the long project name", () => {
  assert.equal(
    hbcfClaimLabel(
      claim({
        projectId: "a",
        leadName: "Smith",
        projectName: "Smith — 1 St",
      }),
    ),
    "Smith",
  );

  assert.equal(
    hbcfClaimLabel(
      claim({
        projectId: "a",
        leadName: "  ",
        projectName: "Chen — 2 St",
      }),
    ),
    "Chen — 2 St",
  );
});

test("colours are assigned stably and wrap past the end of the palette", () => {
  assert.equal(hbcfClaimColour(0), hbcfClaimColour(0));
  assert.notEqual(hbcfClaimColour(0), hbcfClaimColour(1));
  assert.equal(hbcfClaimColour(0), hbcfClaimColour(5));
});