import assert from "node:assert/strict";
import { test } from "vitest";

import {
  fyQuarterBounds,
  fyQuarterOf,
  formatFyQuarter,
} from "@/lib/leads/fy-quarter";

test("August 2026 is FY2027 Q1", () => {
  assert.deepEqual(fyQuarterOf(new Date("2026-08-16T02:00:00.000Z")), {
    fy: 2027,
    quarter: 1,
  });
});

test("each FY quarter classifies its months", () => {
  // Sydney is UTC+10/+11, so use early-UTC times that stay inside the same local day.
  assert.deepEqual(fyQuarterOf(new Date("2026-07-15T02:00:00Z")), {
    fy: 2027,
    quarter: 1,
  });
  assert.deepEqual(fyQuarterOf(new Date("2026-11-15T02:00:00Z")), {
    fy: 2027,
    quarter: 2,
  });
  assert.deepEqual(fyQuarterOf(new Date("2027-02-15T02:00:00Z")), {
    fy: 2027,
    quarter: 3,
  });
  assert.deepEqual(fyQuarterOf(new Date("2027-05-15T02:00:00Z")), {
    fy: 2027,
    quarter: 4,
  });
});

test("the financial year rolls over on 1 July, Sydney time", () => {
  // 30 Jun 2026 23:00 Sydney == 2026-06-30T13:00Z -> still FY2026 Q4
  assert.deepEqual(fyQuarterOf(new Date("2026-06-30T13:00:00Z")), {
    fy: 2026,
    quarter: 4,
  });
  // 1 Jul 2026 00:30 Sydney == 2026-06-30T14:30Z -> FY2027 Q1
  assert.deepEqual(fyQuarterOf(new Date("2026-06-30T14:30:00Z")), {
    fy: 2027,
    quarter: 1,
  });
});

test("FY2027 Q1 starts at Sydney midnight on 1 July 2026", () => {
  const { start, endExclusive, label } = fyQuarterBounds(2027, 1);
  // 1 Jul 2026 00:00 AEST (UTC+10) == 2026-06-30T14:00Z
  assert.equal(start.toISOString(), "2026-06-30T14:00:00.000Z");
  // 1 Oct 2026 00:00 AEST (DST starts first Sunday of October = 4 Oct 2026)
  assert.equal(endExclusive.toISOString(), "2026-09-30T14:00:00.000Z");
  assert.equal(label, "FY2027 Q1");
});

test("bounds are half-open and contiguous across the year", () => {
  const quarters = [1, 2, 3, 4] as const;
  for (let i = 0; i < quarters.length - 1; i++) {
    const a = fyQuarterBounds(2027, quarters[i]);
    const b = fyQuarterBounds(2027, quarters[i + 1]);
    assert.equal(
      a.endExclusive.getTime(),
      b.start.getTime(),
      `gap after Q${quarters[i]}`,
    );
  }
  // Q4 of FY2027 ends where Q1 of FY2028 starts.
  assert.equal(
    fyQuarterBounds(2027, 4).endExclusive.getTime(),
    fyQuarterBounds(2028, 1).start.getTime(),
  );
});

test("a deal at 23:59 on the last local day of a quarter is inside it", () => {
  const { start, endExclusive } = fyQuarterBounds(2027, 1);
  // 30 Sep 2026 23:59 Sydney == 2026-09-30T13:59Z
  const lastMoment = new Date("2026-09-30T13:59:00Z");
  assert.ok(lastMoment >= start && lastMoment < endExclusive);
});

test("a deal at midnight on the first local day of the next quarter is outside", () => {
  const { endExclusive } = fyQuarterBounds(2027, 1);
  const firstOfNext = new Date("2026-09-30T14:00:00Z");
  assert.ok(firstOfNext >= endExclusive);
});

test("quarter bounds survive the Sydney DST transitions", () => {
  // DST starts first Sunday of October, ends first Sunday of April.
  // Q2 FY2027 (Oct-Dec 2026) starts before DST, ends inside it.
  const q2 = fyQuarterBounds(2027, 2);
  assert.equal(q2.start.toISOString(), "2026-09-30T14:00:00.000Z"); // AEST +10
  assert.equal(q2.endExclusive.toISOString(), "2026-12-31T13:00:00.000Z"); // AEDT +11
  // Q4 FY2027 (Apr-Jun 2027) starts during DST's final days.
  const q4 = fyQuarterBounds(2027, 4);
  assert.equal(q4.start.toISOString(), "2027-03-31T13:00:00.000Z"); // AEDT +11
  assert.equal(q4.endExclusive.toISOString(), "2027-06-30T14:00:00.000Z"); // AEST +10
});

test("round trip: every quarter's own start classifies back to itself", () => {
  for (const fy of [2026, 2027, 2028]) {
    for (const q of [1, 2, 3, 4] as const) {
      const { start } = fyQuarterBounds(fy, q);
      assert.deepEqual(fyQuarterOf(start), { fy, quarter: q }, `FY${fy} Q${q}`);
    }
  }
});

test("formatFyQuarter renders the display label", () => {
  assert.equal(formatFyQuarter(2027, 1), "FY2027 Q1");
});
