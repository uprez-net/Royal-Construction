import assert from "node:assert/strict";
import { MilestoneStatus } from "@prisma/client";
import { test } from "vitest";

import { assertMilestoneFieldsForStatus } from "@/lib/domain/projects/milestones";

// #432: 11 Wheat Street's "Certifier Inspection" was Done with an actual date
// of Tue 1 Dec 2026, weeks ahead of the day it was marked.

const now = new Date("2026-11-13T04:00:00Z"); // Fri 13 Nov 2026, 3 pm AEDT
const done = {
  spend: 0,
  startDate: "2026-11-01",
  status: MilestoneStatus.DONE,
};

test("an activity cannot be completed on a day that has not happened", () => {
  assert.throws(
    () =>
      assertMilestoneFieldsForStatus(
        { ...done, actualDate: "2026-12-01" },
        now,
      ),
    /cannot be in the future/,
  );
});

test("today and earlier are fine, on the Sydney calendar", () => {
  assertMilestoneFieldsForStatus({ ...done, actualDate: "2026-11-13" }, now);
  assertMilestoneFieldsForStatus({ ...done, actualDate: "2026-11-05" }, now);
  // 11 pm on the 13th in Sydney is 12:00 UTC: still today there.
  assertMilestoneFieldsForStatus(
    { ...done, actualDate: "2026-11-13T12:00:00.000Z" },
    now,
  );
});

test("a planned activity may carry a future date", () => {
  assertMilestoneFieldsForStatus(
    {
      actualDate: "2026-12-01",
      startDate: "2026-11-20",
      status: MilestoneStatus.PENDING,
    },
    now,
  );
});
