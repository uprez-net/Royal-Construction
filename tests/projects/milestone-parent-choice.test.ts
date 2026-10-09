import { test } from "vitest";
import assert from "node:assert/strict";
import { MilestoneStatus as S } from "@prisma/client";
import { allowedMilestoneTransitions } from "@/lib/domain/projects/milestone-status";
import { updateMilestone } from "@/lib/domain/projects/milestones";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

test("starting a child reports only ancestors actually started and still visits higher ancestors", async () => {
  const leaf = {
    id: "leaf",
    parentId: "already-active",
    projectId: "project",
    status: S.ACTIVE,
    budget: "0",
    spend: null,
  };
  const recorder = recordingDb({
    "project.findUnique": { id: "project", siteManagerId: null },
    "project.update": { spent: "0", siteManagerId: null },
    "milestone.findUnique": (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return id === "leaf"
        ? { projectId: "project" }
        : { parentId: id === "already-active" ? "pending-root" : null };
    },
    "milestone.findUniqueOrThrow": { ...leaf, status: S.PENDING },
    "milestone.update": leaf,
    "milestone.updateMany": (args: unknown) => ({
      count:
        (args as { where: { id: string } }).where.id === "already-active"
          ? 0
          : 1,
    }),
    "milestone.count": 1,
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.findMany": [],
    "tradieSchedule.findMany": [],
  });
  const outcome = await updateMilestone(
    adminPrincipal(),
    { milestoneId: "leaf", status: S.ACTIVE, startDate: "2026-10-09" },
    recorder.db,
  );
  assert.deepEqual(outcome.parentUpdates, [
    { id: "pending-root", status: S.ACTIVE, startDate: new Date("2026-10-09") },
  ]);
  const ancestorWrites = recorder
    .writes()
    .filter((call) => call.operation === "milestone.updateMany");
  assert.deepEqual(
    ancestorWrites.map((call) => call.args),
    [
      {
        where: { id: "already-active", status: { not: S.ACTIVE } },
        data: { status: S.ACTIVE, startDate: new Date("2026-10-09") },
      },
      {
        where: { id: "pending-root", status: { not: S.ACTIVE } },
        data: { status: S.ACTIVE, startDate: new Date("2026-10-09") },
      },
    ],
  );
});

test("only a parent whose children are all waived gains the completion choice", () => {
  assert.ok(
    allowedMilestoneTransitions(S.PENDING, [
      { status: S.NOT_REQUIRED },
    ]).includes(S.DONE),
  );
  assert.ok(
    allowedMilestoneTransitions(S.ACTIVE, [
      { status: S.NOT_REQUIRED },
    ]).includes(S.NOT_REQUIRED),
  );
  assert.ok(!allowedMilestoneTransitions(S.PENDING).includes(S.DONE));
  assert.ok(
    !allowedMilestoneTransitions(S.ACTIVE, [{ status: S.DONE }]).includes(
      S.NOT_REQUIRED,
    ),
  );
});

for (const allWaived of [true, false]) {
  test(
    allWaived
      ? "waiving the final child keeps the parent open"
      : "a completed child still automatically completes its settled parent",
    async () => {
      const row = {
        id: "child",
        parentId: "parent",
        projectId: "project",
        status: S.NOT_REQUIRED,
        budget: "0",
        spend: null,
      };
      const recorder = recordingDb({
        "project.findUnique": { id: "project", siteManagerId: null },
        "project.update": { spent: "0", siteManagerId: null },
        "milestone.findUnique": { projectId: "project" },
        "milestone.findUniqueOrThrow": { ...row, status: S.PENDING },
        "milestone.update": row,
        "milestone.count": (args: unknown) => {
          const { where } = args as {
            where: { parentId?: string; status?: { notIn?: unknown } | string };
          };
          if (!where.parentId) return 1;
          if (typeof where.status === "object") return 0;
          if (where.status === S.NOT_REQUIRED) return allWaived ? 2 : 1;
          return 2;
        },
        "milestone.aggregate": { _sum: { spend: null } },
        "milestone.findMany": [],
        "tradieSchedule.findMany": [],
      });
      const result = await updateMilestone(
        adminPrincipal(),
        { milestoneId: "child", status: S.NOT_REQUIRED },
        recorder.db,
      );
      assert.equal(result.rolledUpParentId, allWaived ? null : "parent");
      const parentWrites = recorder
        .writes()
        .filter(
          (call) =>
            call.operation === "milestone.update"
            && (call.args as { where: { id: string } }).where.id === "parent",
        );
      assert.equal(parentWrites.length, allWaived ? 0 : 1);
      if (!allWaived)
        assert.equal(
          (parentWrites[0].args as { data: { status: string } }).data.status,
          S.DONE,
        );
    },
  );
}

for (const status of [S.DONE, S.NOT_REQUIRED]) {
  test(`the operator can choose ${status} for a parent with only waived children`, async () => {
    const row = {
      id: "parent",
      projectId: "project",
      parentId: null,
      status,
      budget: "0",
      spend: "0",
    };
    const recorder = recordingDb({
      "project.findUnique": { id: "project", siteManagerId: null },
      "project.update": { spent: "0", siteManagerId: null },
      "milestone.findUnique": { projectId: "project" },
      "milestone.findUniqueOrThrow": {
        ...row,
        status: S.PENDING,
        childrenMilestones: [{ status: S.NOT_REQUIRED }],
      },
      "milestone.update": row,
      "milestone.count": 0,
      "milestone.aggregate": { _sum: { spend: null } },
      "milestone.findMany": [],
      "tradieSchedule.findMany": [],
    });
    const outcome = await updateMilestone(
      adminPrincipal(),
      {
        milestoneId: "parent",
        status,
        startDate: "2026-10-01",
        actualDate: "2026-10-02",
        spend: 0,
      },
      recorder.db,
    );
    assert.equal(outcome.milestone.status, status);
  });
}

test("completion propagates through every level of a nested activity", async () => {
  const leaf = {
    id: "leaf",
    parentId: "middle",
    projectId: "project",
    status: S.DONE,
    budget: "0",
    spend: "125",
  };
  const recorder = recordingDb({
    "project.findUnique": { id: "project", siteManagerId: null },
    "project.update": { spent: "125", siteManagerId: null },
    "milestone.findUnique": (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return id === "leaf"
        ? { projectId: "project" }
        : { parentId: id === "middle" ? "root" : null };
    },
    "milestone.findUniqueOrThrow": { ...leaf, status: S.ACTIVE },
    "milestone.update": leaf,
    "milestone.count": (args: unknown) => {
      const where = (args as { where: { parentId?: string; status?: unknown } })
        .where;
      return where.parentId ? (where.status === undefined ? 1 : 0) : 1;
    },
    "milestone.aggregate": { _sum: { spend: "125" } },
    "milestone.findMany": [],
    "tradieSchedule.findMany": [],
  });
  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      milestoneId: "leaf",
      status: S.DONE,
      startDate: "2026-10-09",
      actualDate: "2026-10-10",
      spend: 125,
    },
    recorder.db,
  );
  assert.deepEqual(
    outcome.parentUpdates.map((parent) => [
      parent.id,
      parent.status,
      parent.spend,
    ]),
    [
      ["middle", S.DONE, "125"],
      ["root", S.DONE, "125"],
    ],
  );
});
