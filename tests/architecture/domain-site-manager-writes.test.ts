import assert from "node:assert/strict";

import { MilestoneStatus, ProjectStatus } from "@prisma/client";
import { test } from "vitest";

import { updateProject } from "@/lib/domain/projects/commands";
import { updateMilestone } from "@/lib/domain/projects/milestones";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Hiding a project's money is half of it. A screen that was handed zeros saves
// them back unless the server refuses to take them, and a $0 written over a
// contract sum or an activity's spend is silent: nothing errors, and the first
// sign is a progress claim for the wrong amount.

const SM = "user_sm";
const STORED_COMMERCIALS = {
  paymentStages: [{ name: "Slab", percentage: 20 }],
  totalContractSum: 880000,
};

function projectDb() {
  return recordingDb({
    "project.findUnique": {
      customerId: null,
      id: "p_1",
      Lead: null,
      location: "1 Site St",
      name: "Smith residence",
      siteManagerId: SM,
    },
    "project.findUniqueOrThrow": {
      requirements: {
        commercialsAndClaims: STORED_COMMERCIALS,
        safetyAndSiteLogistics: { old: true },
      },
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      status: ProjectStatus.ON_TRACK,
    },
    "milestone.count": 0,
    "milestone.findMany": [],
  });
}

const projectWrite = (recorder: ReturnType<typeof projectDb>) =>
  (
    recorder.writes().find((call) => call.operation === "project.update")
      ?.args as { data: Record<string, unknown> }
  ).data;

test("a site manager's project save cannot set the contract sum or replace the commercial terms", async () => {
  const recorder = projectDb();

  await updateProject(
    siteManagerPrincipal(SM),
    {
      projectId: "p_1",
      requirements: {
        commercialsAndClaims: { paymentStages: [], totalContractSum: null },
        safetyAndSiteLogistics: { old: false },
      },
      totalBudget: 0,
    },
    recorder.db,
  );

  const data = projectWrite(recorder);
  assert.equal("totalBudget" in data && data.totalBudget !== undefined, false);
  const saved = data.requirements as Record<string, unknown> | undefined;
  // The site manager's own edit goes through; the money does not move.
  assert.deepEqual(saved?.commercialsAndClaims, STORED_COMMERCIALS);
  assert.deepEqual(saved?.safetyAndSiteLogistics, { old: false });
});

test("an admin's project save still sets both", async () => {
  const recorder = projectDb();

  await updateProject(
    adminPrincipal(),
    {
      projectId: "p_1",
      requirements: {
        commercialsAndClaims: { paymentStages: [], totalContractSum: 5 },
      },
      totalBudget: 5,
    },
    recorder.db,
  );

  const data = projectWrite(recorder);
  assert.notEqual(data.totalBudget, undefined);
  assert.deepEqual(
    (data.requirements as Record<string, unknown>).commercialsAndClaims,
    { paymentStages: [], totalContractSum: 5 },
  );
});

function completeActivity(
  principal: ReturnType<typeof siteManagerPrincipal>,
  spend: number,
) {
  const activity = {
    actualDate: null,
    budget: "0",
    id: "activity",
    parentId: null,
    projectId: "project",
    status: MilestoneStatus.ACTIVE,
  };
  const booking = {
    durationDays: 2,
    id: "booking",
    milestoneId: "activity",
    projectId: "project",
    quotedPrice: "1500.50",
    requiresQuote: false,
    status: "CONFIRMED",
    tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" },
  };
  const recorder = recordingDb({
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.count": 0,
    "milestone.findMany": [],
    "milestone.findUnique": { parentId: null, projectId: "project" },
    "milestone.findUniqueOrThrow": { ...activity, childrenMilestones: [] },
    "milestone.update": { ...activity, status: MilestoneStatus.DONE },
    "milestone.updateMany": { count: 0 },
    "project.findUnique": { id: "project", siteManagerId: SM },
    "project.update": { siteManagerId: SM, spent: "0" },
    "tradieSchedule.findMany": [booking],
    "tradieSchedule.update": booking,
    "tradieSchedule.updateMany": { count: 1 },
  });
  return updateMilestone(
    principal,
    {
      actualDate: "2026-11-20",
      milestoneId: "activity",
      spend,
      startDate: "2026-11-10",
      status: MilestoneStatus.DONE,
    },
    recorder.db,
  ).then(() => {
    const write = recorder
      .writes()
      .find((call) => call.operation === "milestone.update");
    return String(
      (write?.args as { data: { spend?: { toString(): string } } }).data.spend,
    );
  });
}

test("a site manager completing an activity records what its bookings cost, not the $0 their screen sent", async () => {
  // The form works spend out from booking prices, which they are not shown, so
  // it sends 0. The server prices the same bookings itself.
  assert.equal(await completeActivity(siteManagerPrincipal(SM), 0), "1500.5");
  assert.equal(
    await completeActivity(siteManagerPrincipal(SM), 999),
    "1500.5",
    "a figure they typed is ignored too",
  );
});

test("an admin's own figure is still the one that is recorded", async () => {
  assert.equal(await completeActivity(adminPrincipal(), 1234), "1234");
});
