import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ProjectStage,
  MilestoneStatus as MS,
  TradieScheduleStatus as TS,
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../support/repo-root";
import {
  DomainAuthorizationError,
  DomainStaleVersionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  readMilestoneTemplate,
  listTemplateCostTasks,
  saveMilestoneTemplate,
  templateRevision,
  validateTemplate,
} from "@/lib/domain/projects/templates";
import {
  createMilestonesFromTemplate,
  rescheduleMilestonesFromStart,
} from "@/lib/domain/projects/milestones";
import { milestoneTargetDates } from "@/lib/domain/projects/milestone-schedule";
import { moveTemplateActivity } from "@/lib/domain/projects/template-tree";
import { missingMilestoneTrade } from "@/lib/domain/projects/tradie-dependencies";
import { milestoneTemplates } from "@/constants/milestoneTemplate";
import type { TemplateActivity } from "@/types/milestone-template";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

const activity = (
  id: string,
  order: number,
  patch: Partial<TemplateActivity> = {},
): TemplateActivity => ({
  id,
  name: id,
  order,
  parentId: null,
  projectStage: ProjectStage.Slab,
  estimatedDays: 5,
  requiredTradeTypeId: null,
  relatedCostLines: [],
  ...patch,
});
const seed = milestoneTemplates.map((row) =>
  activity(`milestone-template-${row.order}`, row.order, {
    ...row,
    parentId:
      row.parentId === null ? null : `milestone-template-${row.parentId}`,
    relatedCostLines: [...(row.relatedCostLines ?? [])],
  }),
);

test("the migration seeds all 83 original activities with five days and no dependency", () => {
  validateTemplate(seed);
  assert.equal(seed.length, 83);
  const migration = readFileSync(
    join(
      REPO_ROOT,
      "prisma/migrations/20261009090000_editable_milestone_template/migration.sql",
    ),
    "utf8",
  );
  for (const row of seed) {
    assert.ok(
      migration.includes(
        `('${row.id}', '${row.name.replaceAll("'", "''")}', ${row.order}, '${row.projectStage}'`,
      ),
    );
    assert.ok(migration.includes(row.parentId ? `'${row.parentId}'` : "NULL"));
  }
  assert.equal(
    (migration.match(/::TEXT\[\], 5, NULL, CURRENT_TIMESTAMP/g) ?? []).length,
    seed.length,
  );
});

test("variable durations use calendar days and keep the first target on the start", () => {
  const targets = milestoneTargetDates(new Date("2026-10-09T00:00:00Z"), [
    { estimatedDays: 2 },
    { estimatedDays: 7 },
    { estimatedDays: 3 },
  ]);
  assert.deepEqual(
    targets.map((date) => date.toISOString().slice(0, 10)),
    ["2026-10-09", "2026-10-11", "2026-10-18"],
  );
});

test("creation snapshots database durations, dependencies, hierarchy and nested budgets", async () => {
  const rows = [
    activity("parent", 1, { estimatedDays: 2 }),
    activity("child", 2, { parentId: "parent", estimatedDays: 7 }),
    activity("grandchild", 3, {
      parentId: "child",
      relatedCostLines: ["Survey"],
      requiredTradeTypeId: "survey",
    }),
  ];
  const recorder = recordingDb({ "milestoneTemplate.findMany": rows });
  await createMilestonesFromTemplate(
    {
      projectId: "job",
      startDate: new Date("2026-10-09"),
      costLines: [{ itemName: "Survey", costExGst: 150 }] as never,
    },
    recorder.db,
  );
  const data = (
    recorder.writes()[0].args as {
      data: {
        id: string;
        name: string;
        parentId: string | null;
        budget: { toString(): string };
        targetDate: Date;
        estimatedDays: number;
        requiredTradeTypeId: string | null;
      }[];
    }
  ).data;
  assert.deepEqual(
    data.map((row) => row.targetDate.toISOString().slice(0, 10)),
    ["2026-10-09", "2026-10-11", "2026-10-18"],
  );
  assert.equal(data[1].parentId, data[0].id);
  assert.equal(data[2].parentId, data[1].id);
  assert.deepEqual(
    data.map((row) => row.budget.toString()),
    ["150", "150", "150"],
  );
  assert.equal(data[2].requiredTradeTypeId, "survey");
  assert.equal(data[1].estimatedDays, 7);
});

test("an empty template refuses project milestone creation before writes", async () => {
  const recorder = recordingDb({ "milestoneTemplate.findMany": [] });
  await assert.rejects(
    () =>
      createMilestonesFromTemplate(
        { projectId: "job", startDate: new Date() },
        recorder.db,
      ),
    DomainValidationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("rescheduling uses the job's durations without re-reading the global template", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [
      { id: "a", estimatedDays: 2 },
      { id: "b", estimatedDays: 7 },
      { id: "c", estimatedDays: 5 },
    ],
  });
  await rescheduleMilestonesFromStart(
    { projectId: "job", startDate: new Date("2026-10-09") },
    recorder.db,
  );
  assert.deepEqual(
    recorder
      .writes()
      .map((write) =>
        (write.args as { data: { targetDate: Date } }).data.targetDate
          .toISOString()
          .slice(0, 10),
      ),
    ["2026-10-09", "2026-10-11", "2026-10-18"],
  );
});

test("dragging under an activity moves its entire subtree and refuses cycles", () => {
  const rows = [
    activity("a", 1),
    activity("child", 2, { parentId: "a" }),
    activity("b", 3),
  ];
  const moved = moveTemplateActivity(rows, "a", "b", "child");
  assert.deepEqual(
    moved.map((row) => [row.id, row.parentId, row.order]),
    [
      ["b", null, 1],
      ["a", "b", 2],
      ["child", "a", 3],
    ],
  );
  validateTemplate(moved);
  assert.throws(
    () => moveTemplateActivity(rows, "a", "child", "child"),
    DomainValidationError,
  );
  assert.throws(
    () => validateTemplate([activity("a", 1, { parentId: "missing" })]),
    DomainValidationError,
  );
});

test("reordering moves the subtree together and detaching makes a main activity", () => {
  const rows = [
    activity("a", 1),
    activity("b", 2),
    activity("child", 3, { parentId: "b" }),
  ];
  assert.deepEqual(
    moveTemplateActivity(rows, "b", "a", "before").map((row) => row.id),
    ["b", "child", "a"],
  );
  const detached = moveTemplateActivity(rows, "child", null, "root");
  assert.equal(detached.at(-1)?.parentId, null);
});

test("only admins can read or write the template, and refusals write nothing", async () => {
  const recorder = recordingDb();
  const principal = { kind: "anonymous", source: "test" } as const;
  await assert.rejects(
    () => readMilestoneTemplate(principal, recorder.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    () =>
      saveMilestoneTemplate(
        principal,
        { revision: "", activities: [] },
        recorder.transactionalDb,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.calls, []);
});

test("a stale tab and invalid dependencies cannot change the template", async () => {
  const rows = [activity("a", 1)];
  const stale = recordingDb({ "milestoneTemplate.findMany": rows });
  await assert.rejects(
    () =>
      saveMilestoneTemplate(
        adminPrincipal(),
        { revision: "stale", activities: rows },
        stale.transactionalDb,
      ),
    DomainStaleVersionError,
  );
  assert.deepEqual(stale.writes(), []);
  const invalid = recordingDb({
    "milestoneTemplate.findMany": rows,
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": null,
  });
  await assert.rejects(
    () =>
      saveMilestoneTemplate(
        adminPrincipal(),
        {
          revision: templateRevision(rows),
          activities: [{ ...rows[0], requiredTradeTypeId: "unknown" }],
        },
        invalid.transactionalDb,
      ),
    DomainValidationError,
  );
  assert.deepEqual(invalid.writes(), []);
});

test("template saves remove obsolete rows and keep parent links on stable IDs", async () => {
  let stored = [activity("a", 1), activity("obsolete", 2)];
  const initial = [...stored];
  const recorder = recordingDb({
    "milestoneTemplate.findMany": () => stored.map((row) => ({ ...row })),
    "tradeType.findMany": [{ id: "plumbing", archivedAt: null }],
    "adminOfferContent.findFirst": null,
    "milestoneTemplate.deleteMany": () => {
      stored = stored.filter((row) => row.id !== "obsolete");
      return { count: 1 };
    },
    "milestoneTemplate.upsert": (args: unknown) => {
      const row = (args as { create: TemplateActivity }).create;
      stored = [...stored.filter((item) => item.id !== row.id), row].sort(
        (a, b) => a.order - b.order,
      );
      return row;
    },
  });
  const next = [
    activity("a", 1, { estimatedDays: 8 }),
    activity("new", 2, { parentId: "a", requiredTradeTypeId: "plumbing" }),
  ];
  const saved = await saveMilestoneTemplate(
    adminPrincipal(),
    { revision: templateRevision(initial), activities: next },
    recorder.transactionalDb,
  );
  assert.deepEqual(saved.activities, next);
  assert.notEqual(saved.revision, templateRevision(initial));
});

test("template saves release positions in bulk and restore unchanged rows without upserting their content", async () => {
  const rows = [
    activity("parent", 2),
    activity("child", 4, { parentId: "parent" }),
    activity("changed", 8),
  ];
  const recorder = recordingDb({
    "milestoneTemplate.findMany": rows,
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": null,
  });
  await saveMilestoneTemplate(
    adminPrincipal(),
    {
      revision: templateRevision(rows),
      activities: [
        ...rows.slice(0, 2),
        { ...rows[2], estimatedDays: 8 },
        activity("new", 9),
      ],
    },
    recorder.transactionalDb,
  );
  const releases = recorder.calls.filter(
    (call) => call.operation === "milestoneTemplate.updateMany",
  );
  assert.deepEqual(
    releases.map((call) => call.args),
    [{ data: { parentId: null } }],
  );
  const raw = recorder.calls.filter(
    (call) => call.operation === "$.executeRaw",
  );
  assert.equal(raw.length, 1);
  assert.deepEqual(raw[0].args, [
    [`UPDATE "MilestoneTemplate" SET "order" = -"order"`],
  ]);
  assert.deepEqual(
    recorder.calls
      .filter((call) => call.operation === "milestoneTemplate.update")
      .map((call) => call.args),
    [
      { where: { id: "parent" }, data: { order: 2, parentId: null } },
      { where: { id: "child" }, data: { order: 4, parentId: "parent" } },
    ],
  );
  assert.deepEqual(
    recorder.calls
      .filter((call) => call.operation === "milestoneTemplate.upsert")
      .map((call) => (call.args as { where: { id: string } }).where.id),
    ["changed", "new"],
  );
  assert.ok(
    recorder.operations().indexOf("$.executeRaw")
      < recorder.operations().indexOf("milestoneTemplate.deleteMany"),
  );
});

test("only a confirmed booking in the right category on this milestone clears the warning", () => {
  const milestone = {
    id: "a",
    status: MS.ACTIVE,
    requiredTradeType: { label: "Plumbing" },
  };
  const booking = {
    milestoneId: "a",
    status: TS.CONFIRMED,
    tradie: { trade: "Plumbing" },
  };
  assert.equal(missingMilestoneTrade(milestone, []), "Plumbing");
  for (const status of [
    TS.PENDING,
    TS.AWAITING_ADMIN_APPROVAL,
    TS.PENDING_FINAL_CONFIRMATION,
    TS.DECLINED,
    TS.CANCELLED,
  ])
    assert.equal(
      missingMilestoneTrade(milestone, [{ ...booking, status }]),
      "Plumbing",
    );
  assert.equal(
    missingMilestoneTrade(milestone, [{ ...booking, milestoneId: "b" }]),
    "Plumbing",
  );
  assert.equal(
    missingMilestoneTrade(milestone, [
      { ...booking, tradie: { trade: "Electrical" } },
    ]),
    "Plumbing",
  );
  assert.equal(missingMilestoneTrade(milestone, [booking]), null);
  for (const status of [MS.PENDING, MS.DONE, MS.NOT_REQUIRED])
    assert.equal(missingMilestoneTrade({ ...milestone, status }, []), null);
});

test("cost-line choices come from admin cost-schedule task names, deduplicated", async () => {
  const task = (id: string, name: string) => ({
    id,
    taskKey: id,
    task: name,
    phase: "Slab",
    defaultInclude: true,
    priceMode: "none",
  });
  const recorder = recordingDb({
    "adminOfferContent.findFirst": {
      costSchedule: {
        rows: [task("a", "Survey"), task("b", "Survey"), task("c", "Plumbing")],
        rateConstants: {},
      },
    },
  });
  assert.deepEqual(await listTemplateCostTasks(adminPrincipal(), recorder.db), [
    "Survey",
    "Plumbing",
  ]);
});

test("new cost-line mappings must name an admin cost-schedule task", async () => {
  const rows = [activity("a", 1)];
  const recorder = recordingDb({
    "milestoneTemplate.findMany": rows,
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": {
      costSchedule: {
        rows: [
          {
            id: "survey",
            taskKey: "survey",
            task: "Survey",
            phase: "Slab",
            defaultInclude: true,
            priceMode: "none",
          },
        ],
        rateConstants: {},
      },
    },
  });
  await assert.rejects(
    () =>
      saveMilestoneTemplate(
        adminPrincipal(),
        {
          revision: templateRevision(rows),
          activities: [
            activity("a", 1, { relatedCostLines: ["Made up cost"] }),
          ],
        },
        recorder.transactionalDb,
      ),
    DomainValidationError,
  );
  assert.deepEqual(recorder.writes(), []);
  await saveMilestoneTemplate(
    adminPrincipal(),
    {
      revision: templateRevision(rows),
      activities: [activity("a", 1, { relatedCostLines: ["Survey"] })],
    },
    recorder.transactionalDb,
  );
  assert.ok(
    recorder
      .writes()
      .some((call) => call.operation === "milestoneTemplate.upsert"),
  );
});
