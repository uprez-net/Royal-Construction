import assert from "node:assert/strict";

import { test } from "vitest";

import { MilestoneStatus, ProjectStatus } from "@prisma/client";

import { DomainValidationError } from "@/lib/domain/errors";
import { updateProject } from "@/lib/domain/projects/commands";
import {
  hasWorkStarted,
  MILESTONE_SPACING_DAYS,
  milestoneTargetDate,
} from "@/lib/domain/projects/milestone-schedule";
import {
  createMilestonesFromTemplate,
  updateMilestone,
} from "@/lib/domain/projects/milestones";
import { ProjectDateBlockerError } from "@/lib/domain/projects/readiness";

import { adminPrincipal, recordingDb } from "./domain-harness";
import { milestoneTemplates } from "@/constants/milestoneTemplate";

// Moving a project's start date re-dates every activity from it, in the same
// transaction as the move. These run the command against a recorder.

const STORED_START = new Date("2026-06-01T00:00:00.000Z");

function projectDb(
  extra: Record<string, unknown> = {},
  requirements: Record<string, unknown> = {},
) {
  return recordingDb({
    "project.findUnique": {
      customerId: null,
      id: "p_1",
      Lead: null,
      location: "1 Site St",
      name: "Smith residence",
      siteManagerId: null,
    },
    "project.findUniqueOrThrow": {
      requirements,
      startDate: STORED_START,
      status: ProjectStatus.ON_TRACK,
    },
    "milestone.findMany": [{ id: "m_a" }, { id: "m_b" }, { id: "m_c" }],
    // Nothing started yet, so the start date is still a plan.
    "milestone.count": 0,
    ...extra,
  });
}

type Write = { operation: string; args: unknown };

const milestoneWrites = (writes: readonly Write[]) =>
  writes
    .filter((write) => write.operation === "milestone.update")
    .map((write) => {
      const args = write.args as {
        where: { id: string };
        data: { targetDate: Date };
      };
      return [args.where.id, args.data.targetDate.toISOString().slice(0, 10)];
    });

test("activities are spaced five calendar days apart, the first on the start", () => {
  const start = new Date("2026-06-08T00:00:00.000Z");

  assert.equal(MILESTONE_SPACING_DAYS, 5);
  assert.equal(
    milestoneTargetDate(start, 0).toISOString(),
    start.toISOString(),
  );
  assert.equal(
    milestoneTargetDate(start, 3).toISOString().slice(0, 10),
    "2026-06-23",
  );
});

test("moving the start date re-dates every activity, in order", async () => {
  const recorder = projectDb();

  const result = await updateProject(
    adminPrincipal(),
    { projectId: "p_1", startDate: "2026-06-08" },
    recorder.db,
  );

  assert.equal(result.rescheduledMilestones, 3);

  const [read] = recorder.calls.filter(
    (call) => call.operation === "milestone.findMany",
  );
  assert.deepEqual((read.args as { orderBy: unknown }).orderBy, {
    order: "asc",
  });

  assert.deepEqual(milestoneWrites(recorder.writes()), [
    ["m_a", "2026-06-08"],
    ["m_b", "2026-06-13"],
    ["m_c", "2026-06-18"],
  ]);

  // The project write comes first, and the move is on the record.
  const operations = recorder.writes().map((write) => write.operation);
  assert.equal(operations[0], "project.update");
  assert.equal(operations.at(-1), "activityLog.create");
});

test("re-sending the stored start date leaves the schedule alone", async () => {
  const recorder = projectDb();

  const result = await updateProject(
    adminPrincipal(),
    { projectId: "p_1", startDate: STORED_START.toISOString() },
    recorder.db,
  );

  assert.equal(result.rescheduledMilestones, 0);
  assert.deepEqual(milestoneWrites(recorder.writes()), []);
  assert.equal(recorder.operations().includes("milestone.findMany"), false);
});

test("saving other fields never touches the schedule", async () => {
  const recorder = projectDb();

  await updateProject(
    adminPrincipal(),
    { projectId: "p_1", name: "Smith residence (revised)" },
    recorder.db,
  );

  assert.deepEqual(
    recorder.writes().map((write) => write.operation),
    ["project.update"],
  );
});

test("a refused start date moves nothing", async () => {
  // Signed on 10 June: a start on 8 June is before the contract existed.
  const recorder = projectDb(
    {},
    { legalAdministration: { signedDate: "2026-06-10" } },
  );

  await assert.rejects(
    () =>
      updateProject(
        adminPrincipal(),
        { projectId: "p_1", startDate: "2026-06-08" },
        recorder.db,
      ),
    ProjectDateBlockerError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a new project's activities follow the same spacing", async () => {
  const recorder = recordingDb({
    "milestoneTemplate.findMany": milestoneTemplates.map((row) => ({
      ...row,
      id: `template-${row.order}`,
      parentId: row.parentId === null ? null : `template-${row.parentId}`,
      relatedCostLines: [...(row.relatedCostLines ?? [])],
      estimatedDays: 5,
      requiredTradeTypes: [],
    })),
  });
  const start = new Date("2026-06-08T00:00:00.000Z");

  await createMilestonesFromTemplate(
    { projectId: "p_1", startDate: start },
    recorder.db,
  );

  const [write] = recorder.writes();
  const rows = (
    write.args as { data: { order: number; targetDate: Date }[] }
  ).data.sort((a, b) => a.order - b.order);

  rows.forEach((row, position) => {
    assert.equal(
      row.targetDate.toISOString(),
      milestoneTargetDate(start, position).toISOString(),
    );
  });
  assert.equal(rows[0].targetDate.toISOString(), start.toISOString());
});

/* ----------------------------------------- once work starts, the date is set */

test("work has started once any activity is active or done", () => {
  const { PENDING, ACTIVE, DONE, NOT_REQUIRED } = MilestoneStatus;
  assert.equal(
    hasWorkStarted([{ status: PENDING }, { status: NOT_REQUIRED }]),
    false,
  );
  assert.equal(hasWorkStarted([{ status: PENDING }, { status: ACTIVE }]), true);
  assert.equal(hasWorkStarted([{ status: DONE }]), true);
});

test("the start date cannot be moved once work has started", async () => {
  const recorder = projectDb({ "milestone.count": 1 });

  await assert.rejects(
    () =>
      updateProject(
        adminPrincipal(),
        { projectId: "p_1", startDate: "2026-06-08" },
        recorder.db,
      ),
    DomainValidationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("other project fields can still be saved after work has started", async () => {
  const recorder = projectDb({ "milestone.count": 1 });

  await updateProject(
    adminPrincipal(),
    { name: "Smith residence (revised)", projectId: "p_1" },
    recorder.db,
  );

  assert.deepEqual(
    recorder.writes().map((write) => write.operation),
    ["project.update"],
  );
});

function startingDb(startedAlready: number) {
  return recordingDb({
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.count": startedAlready,
    "milestone.findMany": [{ id: "m_a" }, { id: "m_b" }],
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      id: "m_a",
      name: "Peg out survey",
      parentId: null,
      projectId: "p_1",
      status: MilestoneStatus.PENDING,
    },
    "milestone.update": {
      budget: { toString: () => "0" },
      id: "m_a",
      name: "Peg out survey",
      parentId: null,
      projectId: "p_1",
      spend: null,
      status: MilestoneStatus.ACTIVE,
    },
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "Smith residence",
      siteManagerId: null,
    },
    "project.findUniqueOrThrow": { startDate: STORED_START },
    "project.update": { siteManagerId: null, spent: "0" },
  });
}

test("starting the first activity sets the start date and re-dates the schedule", async () => {
  const recorder = startingDb(0);

  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      milestoneId: "m_a",
      startDate: "2026-06-15",
      status: MilestoneStatus.ACTIVE,
    },
    recorder.db,
  );

  assert.equal(
    outcome.projectStartDate?.toISOString().slice(0, 10),
    "2026-06-15",
  );

  // The schedule is re-dated from the day work began…
  const rescheduled = recorder
    .writes()
    .filter(
      (write) =>
        write.operation === "milestone.update"
        && "targetDate" in (write.args as { data: object }).data
        && Object.keys((write.args as { data: object }).data).length === 1,
    )
    .map((write) =>
      (write.args as { data: { targetDate: Date } }).data.targetDate
        .toISOString()
        .slice(0, 10),
    );
  assert.deepEqual(rescheduled, ["2026-06-15", "2026-06-20"]);

  // …and the project carries it, with the move on record.
  const projectWrite = recorder
    .writes()
    .find((write) => write.operation === "project.update");
  assert.equal(
    (
      projectWrite?.args as { data: { startDate?: Date } }
    ).data.startDate?.toISOString(),
    new Date("2026-06-15").toISOString(),
  );
  assert.ok(
    recorder.operations().includes("activityLog.create"),
    "the start date moved with nothing on record",
  );
});

test("starting a later activity leaves the start date and schedule alone", async () => {
  const recorder = startingDb(1);

  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      milestoneId: "m_a",
      startDate: "2026-06-15",
      status: MilestoneStatus.ACTIVE,
    },
    recorder.db,
  );

  assert.equal(outcome.projectStartDate, null);
  assert.equal(recorder.operations().includes("activityLog.create"), false);
  assert.equal(
    recorder.writes().filter((write) => write.operation === "milestone.update")
      .length,
    1,
  );
});
