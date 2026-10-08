import assert from "node:assert/strict";

import { test } from "vitest";

import { ProjectStatus } from "@prisma/client";

import { updateProject } from "@/lib/domain/projects/commands";
import {
  MILESTONE_SPACING_DAYS,
  milestoneTargetDate,
} from "@/lib/domain/projects/milestone-schedule";
import { createMilestonesFromTemplate } from "@/lib/domain/projects/milestones";
import { ProjectDateBlockerError } from "@/lib/domain/projects/readiness";

import { adminPrincipal, recordingDb } from "./domain-harness";

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
  const recorder = recordingDb();
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
