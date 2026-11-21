import assert from "node:assert/strict";

import { MilestoneStatus, Prisma, TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import { DomainAuthorizationError } from "@/lib/domain/errors";
import { addMaterialToProject } from "@/lib/domain/projects/resources";
import { createMilestone } from "@/lib/domain/projects/milestones";
import { transitionTradieSchedule } from "@/lib/domain/tradies/schedules";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Issue #556: a site manager can record site work but not write money. Each
// test below is a write a site manager's screen could reach, or a forged call
// to one, and asserts the figure never reaches the database.

const SM = "user_sm";

function projectDb() {
  return recordingDb({
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "Smith residence",
      siteManagerId: SM,
    },
    "milestone.findFirst": null,
    "milestone.findMany": [],
    "milestone.create": {
      id: "m_1",
      name: "Slab",
      budget: new Prisma.Decimal("10000"),
      spend: null,
      status: MilestoneStatus.PENDING,
      projectId: "p_1",
      projectStage: "SLAB",
      order: 1,
    },
  });
}

const createArgs = {
  name: "Slab",
  targetDate: "2026-12-01",
  budget: 4200,
  projectStage: "SLAB" as never,
  projectId: "p_1",
};

test("a site manager's new activity stores a 0 budget, not the one they sent", async () => {
  const recorder = projectDb();

  const created = await createMilestone(
    siteManagerPrincipal(SM),
    createArgs,
    recorder.db,
  );

  const write = recorder
    .writes()
    .find((c) => c.operation === "milestone.create");
  assert.ok(write);
  // 0 for the office to price, not the $10,000 column default, which the
  // Financials tab would sum into the stage and tender figures.
  assert.equal(
    String((write.args as { data: { budget?: unknown } }).data.budget),
    "0",
  );
  assert.equal(created.budget, "0");
});

test("the office's new activity stores the budget it sent", async () => {
  const recorder = projectDb();

  const created = await createMilestone(
    adminPrincipal(),
    createArgs,
    recorder.db,
  );

  const write = recorder
    .writes()
    .find((c) => c.operation === "milestone.create");
  const data = (write!.args as { data: { budget: Prisma.Decimal } }).data;
  assert.equal(data.budget.toString(), "4200");
  assert.equal(created.budget, "10000");
});

test("a site manager cannot add a material, so no cost is written", async () => {
  const recorder = recordingDb();

  await assert.rejects(
    addMaterialToProject(
      siteManagerPrincipal(SM),
      {
        category: "Cement",
        name: "Bag",
        projectId: "p_1",
        quantity: 2,
        totalCost: 20,
        unitCost: 10,
      },
      recorder.db,
    ),
    (error: unknown) =>
      error instanceof DomainAuthorizationError
      && error.message === "Materials are costed by the office.",
  );
  // Refused before the project is read, so nothing is written either.
  assert.deepEqual(recorder.calls, []);
});

test("a site manager cannot record a tradie quote through a booking transition", async () => {
  const recorder = recordingDb();

  await assert.rejects(
    transitionTradieSchedule(
      siteManagerPrincipal(SM),
      {
        quote: 1500,
        quoteUnit: "FIXED",
        scheduleId: "schedule_1",
        toStatus: TradieScheduleStatus.QUOTE_RECEIVED,
      } as never,
      recorder.db,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.calls, []);
});
