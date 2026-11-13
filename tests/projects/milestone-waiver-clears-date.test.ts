import assert from "node:assert/strict";
import { MilestoneStatus as S } from "@prisma/client";
import { test } from "vitest";

import { updateMilestone } from "@/lib/domain/projects/milestones";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// A waiver that sends no completion date must not keep a stored future one
// (CodeRabbit on #433): the date guard only sees a date that was sent.

function waive(storedActualDate: Date | null) {
  const activity = {
    id: "activity",
    parentId: null,
    projectId: "project",
    status: S.PENDING,
    actualDate: storedActualDate,
    budget: "0",
    spend: null,
  };
  const recorder = recordingDb({
    "project.findUnique": { id: "project", siteManagerId: null },
    "project.update": { spent: "0", siteManagerId: null },
    "milestone.findUnique": { projectId: "project", parentId: null },
    "milestone.findUniqueOrThrow": activity,
    "milestone.update": { ...activity, status: S.NOT_REQUIRED },
    "milestone.updateMany": { count: 0 },
    "milestone.count": 0,
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.findMany": [],
    "tradieSchedule.findMany": [],
  });
  return updateMilestone(
    adminPrincipal(),
    { milestoneId: "activity", status: S.NOT_REQUIRED },
    recorder.db,
  ).then(() => {
    const write = recorder
      .writes()
      .find((call) => call.operation === "milestone.update");
    return (write?.args as { data: { actualDate?: Date | null } }).data
      .actualDate;
  });
}

test("a waiver with no completion date clears a stored future one", async () => {
  assert.equal(await waive(new Date("2099-01-01T00:00:00Z")), null);
});

test("a stored past completion date is left as it is", async () => {
  assert.equal(await waive(new Date("2020-01-01T00:00:00Z")), undefined);
  assert.equal(await waive(null), undefined);
});
