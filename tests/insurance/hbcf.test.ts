import assert from "node:assert/strict";
import { test } from "vitest";

import {
  HBCF_DEFAULT_PROJECTION_MONTHS,
  // HBCF_TOTAL_SUM_ASSURED,
  hbcfAssessment,
  hbcfAxisRange,
  hbcfClaimColour,
  hbcfClaimLabel,
  hbcfIsActiveOn,
  hbcfNeedRange,
  hbcfProjectBreach,
  hbcfProjectionMonths,
  hbcfUsedAt,
  type HbcfProjectClaim,
} from "@/lib/insurance/hbcf";

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
  assert.equal(hbcfNeedRange({ budget: "$700K+" })?.isOpenEnded, true);
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

  assert.equal(hbcfUsedAt(claims, TODAY), 200_000);

  assert.equal(hbcfUsedAt(claims, new Date(2026, 8, 15)), 600_000);
});

test("an active commitment contributes its full amount midway through its window", () => {
  const single = claim({
    projectId: "single",
    claimAmount: 600_000,
    insuranceClaimStartDate: "2026-01-01",
    insuranceClaimEndDate: "2026-06-30",
  });

  assert.equal(hbcfUsedAt([single], new Date(2026, 2, 15)), 600_000);
});

test("an active commitment still contributes its full amount on its last day", () => {
  const single = claim({
    projectId: "single",
    claimAmount: 600_000,
    insuranceClaimStartDate: "2026-01-01",
    insuranceClaimEndDate: "2026-06-30",
  });

  assert.equal(hbcfUsedAt([single], new Date(2026, 5, 30)), 600_000);
});

test("a commitment contributes zero the day after its end date", () => {
  const single = claim({
    projectId: "single",
    claimAmount: 600_000,
    insuranceClaimStartDate: "2026-01-01",
    insuranceClaimEndDate: "2026-06-30",
  });

  assert.equal(hbcfUsedAt([single], new Date(2026, 6, 1)), 0);
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

test("an estimated start date becomes the capacity planning floor", () => {
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "finished-before-planning",
        claimAmount: 400_000,
        insuranceClaimEndDate: "2027-01-01",
      }),
      claim({
        projectId: "active-at-planning",
        claimAmount: 300_000,
        insuranceClaimEndDate: "2027-12-31",
      }),
    ],
    needRange: {
      low: 350_000,
      high: 400_000,
      source: "budgetBracket",
      isOpenEnded: false,
    },
    today: TODAY,
    estimatedStartDate: new Date(2027, 0, 15),
    totalSumAssured: 800_000,
  });

  assert.equal(result.planningStartDate, "2027-01-15");
  assert.equal(result.usedAmount, 700_000);
  assert.equal(result.directAvailable, 100_000);
  assert.equal(result.availableAtPlanningStart, 500_000);
  assert.equal(result.sufficient, true);
  assert.equal(result.canStartFrom, "2027-01-15");
  assert.equal(result.projectedWindow?.start, "2027-01-15");
  assert.equal(result.projectedWindow?.end, "2028-07-15");
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
    totalSumAssured: 8_000_000,
  });

  assert.equal(result.totalSumAssured, 8_000_000);
  assert.equal(result.directAvailable, 7_800_000);
});

test("two large overlapping claims must both end before capacity is sufficient", () => {
  // Pool: $800K. Two $500K claims overlap. Lead needs $400K.
  // The old running-total approach (starting from a floored directAvailable
  // of 0) would free $500K at the first expiry and report that date — but
  // the other $500K claim is still active, leaving only $300K free.
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "a",
        leadName: "A",
        claimAmount: 500_000,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-12-31",
      }),
      claim({
        projectId: "b",
        leadName: "B",
        claimAmount: 500_000,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2027-06-30",
      }),
    ],
    needRange: {
      low: 350_000,
      high: 400_000,
      source: "estimatedValue",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  // A expires Dec 31 — B still holds $500K, only $300K free < $400K.
  // B expires Jun 30 2027 — pool fully free, $800K >= $400K.
  assert.equal(result.directAvailable, 0);
  assert.equal(result.sufficient, false);
  assert.notEqual(result.canStartFrom, "2026-12-31");
  assert.equal(result.canStartFrom, "2027-06-30");
  assert.equal(result.decisiveClaim?.label, "B");
  assert.equal(result.decisiveClaim?.freesOn, "2027-06-30");
});

test("over-committed pool with four overlapping claims frees only at the last expiry", () => {
  // Mirrors the real scenario from the bug report: four overlapping claims
  // exceed the $800K pool. The lead needs $500K. The earliest sufficient date
  // is only reached once ALL overlapping commitments have ended.
  const result = hbcfAssessment({
    claims: [
      claim({
        projectId: "a",
        leadName: "A",
        claimAmount: 605_000,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-12-31",
      }),
      claim({
        projectId: "b",
        leadName: "B",
        claimAmount: 766_500,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2027-03-31",
      }),
      claim({
        projectId: "c",
        leadName: "C",
        claimAmount: 766_500,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2027-06-30",
      }),
      claim({
        projectId: "d",
        leadName: "D",
        claimAmount: 57_200,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-09-30",
      }),
    ],
    needRange: {
      low: 450_000,
      high: 500_000,
      source: "estimatedValue",
      isOpenEnded: false,
    },
    today: TODAY,
    totalSumAssured: 800_000,
  });

  // D expires Sep 30 — A+B+C still hold $2.138M, not enough.
  // A expires Dec 31 — B+C still hold $1.533M, not enough.
  // B expires Mar 31 — C still holds $766.5K, only $33.5K free, not enough.
  // C expires Jun 30 — pool fully free, $800K >= $500K.
  assert.equal(result.directAvailable, 0);
  assert.equal(result.sufficient, false);
  assert.notEqual(result.canStartFrom, "2026-09-30");
  assert.notEqual(result.canStartFrom, "2026-12-31");
  assert.notEqual(result.canStartFrom, "2027-03-31");
  assert.equal(result.canStartFrom, "2027-06-30");
  assert.equal(result.decisiveClaim?.label, "C");
  assert.equal(result.decisiveClaim?.freesOn, "2027-06-30");
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

/* ── Project overcommitment ─────────────────────────────────────────────── */

const POOL = 1_000_000;

test("no breach when the concurrent peak fits inside the pool", () => {
  assert.equal(
    hbcfProjectBreach({
      claims: [
        claim({ projectId: "subject", claimAmount: 600_000 }),
        claim({ projectId: "other", claimAmount: 300_000 }),
      ],
      projectId: "subject",
      totalSumAssured: POOL,
    }),
    null,
  );
});

test("a breach reports the peak day, the overrun and who else is on the book", () => {
  const breach = hbcfProjectBreach({
    claims: [
      claim({
        projectId: "subject",
        leadName: "Smith",
        claimAmount: 600_000,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-12-31",
      }),
      claim({
        projectId: "early",
        leadName: "Chen",
        claimAmount: 300_000,
        insuranceClaimStartDate: "2025-06-01",
        insuranceClaimEndDate: "2026-06-30",
      }),
      claim({
        projectId: "late",
        leadName: "Patel",
        claimAmount: 250_000,
        insuranceClaimStartDate: "2026-03-01",
        insuranceClaimEndDate: "2026-09-30",
      }),
    ],
    projectId: "subject",
    totalSumAssured: POOL,
  });

  assert.ok(breach);
  // 1 Mar is where the third window opens: 600k + 300k + 250k all live.
  assert.equal(breach.peakDate, "2026-03-01");
  assert.equal(breach.peakUsedAmount, 1_150_000);
  assert.equal(breach.exceededBy, 150_000);
  assert.equal(breach.claimAmount, 600_000);
  assert.deepEqual(
    breach.overlappingClaims.map((claim) => claim.label),
    ["Chen", "Patel"],
  );
});

test("claims that never overlap the window are not counted against it", () => {
  // Both are big enough to breach on their own totals, but they are never live
  // at the same time — the naive sum would warn here and be wrong.
  assert.equal(
    hbcfProjectBreach({
      claims: [
        claim({
          projectId: "subject",
          claimAmount: 700_000,
          insuranceClaimStartDate: "2026-01-01",
          insuranceClaimEndDate: "2026-06-30",
        }),
        claim({
          projectId: "after",
          claimAmount: 700_000,
          insuranceClaimStartDate: "2026-07-01",
          insuranceClaimEndDate: "2026-12-31",
        }),
      ],
      projectId: "subject",
      totalSumAssured: POOL,
    }),
    null,
  );
});

test("a claim already open when the window starts still counts", () => {
  const breach = hbcfProjectBreach({
    claims: [
      claim({
        projectId: "subject",
        claimAmount: 600_000,
        insuranceClaimStartDate: "2026-01-01",
        insuranceClaimEndDate: "2026-12-31",
      }),
      claim({
        projectId: "running",
        claimAmount: 500_000,
        insuranceClaimStartDate: "2025-01-01",
        insuranceClaimEndDate: "2026-02-01",
      }),
    ],
    projectId: "subject",
    totalSumAssured: POOL,
  });

  assert.ok(breach);
  assert.equal(breach.peakDate, "2026-01-01");
  assert.equal(breach.exceededBy, 100_000);
});

test("no breach when the project holds no cover, or the pool is unset", () => {
  const claims = [
    claim({ projectId: "subject", claimAmount: 900_000 }),
    claim({ projectId: "other", claimAmount: 900_000 }),
  ];

  assert.equal(
    hbcfProjectBreach({ claims, projectId: "absent", totalSumAssured: POOL }),
    null,
  );
  assert.equal(
    hbcfProjectBreach({ claims, projectId: "subject", totalSumAssured: 0 }),
    null,
  );
});

test("an unreadable cover window is silent rather than alarming", () => {
  assert.equal(
    hbcfProjectBreach({
      claims: [
        claim({
          projectId: "subject",
          claimAmount: 900_000,
          insuranceClaimStartDate: "not a date",
          insuranceClaimEndDate: "also not a date",
        }),
        claim({ projectId: "other", claimAmount: 900_000 }),
      ],
      projectId: "subject",
      totalSumAssured: POOL,
    }),
    null,
  );
});
