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
  saveMilestoneTemplateWithEffects,
  templateRevision,
  validateTemplate,
} from "@/lib/domain/projects/templates";
import {
  createMilestonesFromTemplate,
  rescheduleMilestonesFromStart,
} from "@/lib/domain/projects/milestones";
import { milestoneTargetDates } from "@/lib/domain/projects/milestone-schedule";
import { moveTemplateActivity } from "@/lib/domain/projects/template-tree";
import { missingMilestoneTrades } from "@/lib/domain/projects/tradie-dependencies";
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
  requiredTradeTypeIds: [],
  relatedCostLines: [],
  ...patch,
});
/** The row as Prisma returns it: the trades come back as a relation. */
const dbRow = ({ requiredTradeTypeIds, ...row }: TemplateActivity) => ({
  ...row,
  requiredTradeTypes: requiredTradeTypeIds.map((id) => ({ id })),
});
/** What the save wrote, read back the way Prisma would return it. */
const upserted = (args: unknown) => {
  const { create } = args as {
    create: Omit<TemplateActivity, "requiredTradeTypeIds"> & {
      requiredTradeTypes: { connect: { id: string }[] };
    };
  };
  return { ...create, requiredTradeTypes: create.requiredTradeTypes.connect };
};
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
      requiredTradeTypeIds: ["survey", "plumbing"],
    }),
  ];
  const recorder = recordingDb({
    "milestoneTemplate.findMany": rows.map(dbRow),
  });
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
  // createMany cannot write the relation, so only the activity that needs
  // trades is updated afterwards, with every trade it needs.
  assert.deepEqual(
    recorder
      .writes()
      .filter((write) => write.operation === "milestone.update")
      .map((write) => write.args),
    [
      {
        where: { id: data[2].id },
        data: {
          requiredTradeTypes: {
            connect: [{ id: "survey" }, { id: "plumbing" }],
          },
        },
      },
    ],
  );
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
  const stale = recordingDb({ "milestoneTemplate.findMany": rows.map(dbRow) });
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
    "milestoneTemplate.findMany": rows.map(dbRow),
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": null,
  });
  await assert.rejects(
    () =>
      saveMilestoneTemplate(
        adminPrincipal(),
        {
          revision: templateRevision(rows),
          activities: [{ ...rows[0], requiredTradeTypeIds: ["unknown"] }],
        },
        invalid.transactionalDb,
      ),
    DomainValidationError,
  );
  assert.deepEqual(invalid.writes(), []);
});

test("template saves remove obsolete rows and keep parent links on stable IDs", async () => {
  const initial = [activity("a", 1), activity("obsolete", 2)];
  let stored = initial.map(dbRow);
  const recorder = recordingDb({
    "milestoneTemplate.findMany": () => stored.map((row) => ({ ...row })),
    "tradeType.findMany": [
      { id: "plumbing", archivedAt: null },
      { id: "electrical", archivedAt: null },
    ],
    "adminOfferContent.findFirst": null,
    "milestoneTemplate.deleteMany": () => {
      stored = stored.filter((row) => row.id !== "obsolete");
      return { count: 1 };
    },
    "milestoneTemplate.upsert": (args: unknown) => {
      const row = upserted(args);
      stored = [...stored.filter((item) => item.id !== row.id), row].sort(
        (a, b) => a.order - b.order,
      );
      return row;
    },
    // No project activity is open against "a", whose duration changes.
    "milestone.findMany": [],
  });
  const next = [
    activity("a", 1, { estimatedDays: 8 }),
    activity("new", 2, {
      parentId: "a",
      requiredTradeTypeIds: ["electrical", "plumbing"],
    }),
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
    "milestoneTemplate.findMany": rows.map(dbRow),
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": null,
    // No project activity is open against the changed row.
    "milestone.findMany": [],
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
    requiredTradeTypes: [{ label: "Plumbing" }],
  };
  const booking = {
    milestoneId: "a",
    status: TS.CONFIRMED,
    tradie: { trade: "Plumbing" },
  };
  assert.deepEqual(missingMilestoneTrades(milestone, []), ["Plumbing"]);
  for (const status of [
    TS.PENDING,
    TS.AWAITING_ADMIN_APPROVAL,
    TS.PENDING_FINAL_CONFIRMATION,
    TS.DECLINED,
    TS.CANCELLED,
  ])
    assert.deepEqual(
      missingMilestoneTrades(milestone, [{ ...booking, status }]),
      ["Plumbing"],
    );
  assert.deepEqual(
    missingMilestoneTrades(milestone, [{ ...booking, milestoneId: "b" }]),
    ["Plumbing"],
  );
  assert.deepEqual(
    missingMilestoneTrades(milestone, [
      { ...booking, tradie: { trade: "Electrical" } },
    ]),
    ["Plumbing"],
  );
  assert.deepEqual(missingMilestoneTrades(milestone, [booking]), []);
  // The same trade as a request would accept it, whatever the directory's case.
  assert.deepEqual(
    missingMilestoneTrades(milestone, [
      { ...booking, tradie: { trade: " plumbing " } },
    ]),
    [],
  );
  for (const status of [MS.PENDING, MS.DONE, MS.NOT_REQUIRED])
    assert.deepEqual(missingMilestoneTrades({ ...milestone, status }, []), []);
});

test("an activity needing two trades warns for each until both are confirmed", () => {
  const milestone = {
    id: "a",
    status: MS.ACTIVE,
    requiredTradeTypes: [{ label: "Plumbing" }, { label: "Electrical" }],
  };
  const plumber = {
    milestoneId: "a",
    status: TS.CONFIRMED,
    tradie: { trade: "Plumbing" },
  };
  const electrician = { ...plumber, tradie: { trade: "Electrical" } };
  assert.deepEqual(missingMilestoneTrades(milestone, []), [
    "Plumbing",
    "Electrical",
  ]);
  assert.deepEqual(missingMilestoneTrades(milestone, [plumber]), [
    "Electrical",
  ]);
  assert.deepEqual(
    missingMilestoneTrades(milestone, [plumber, electrician]),
    [],
  );
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
    "milestoneTemplate.findMany": rows.map(dbRow),
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

test("a changed duration reaches open project activities, re-plans what follows, and leaves completed ones alone", async () => {
  const rows = [activity("frame", 1), activity("roof", 2)];
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const recorder = recordingDb({
    "milestoneTemplate.findMany": rows.map(dbRow),
    "tradeType.findMany": [],
    "adminOfferContent.findFirst": null,
    "milestone.findMany": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      // The open activities created from the changed build-sequence rows.
      if (where.templateId)
        return [{ id: "job-frame", projectId: "job", templateId: "frame" }];
      // The changed activities, read back with their new duration.
      if (where.id)
        return [
          {
            estimatedDays: 3,
            id: "job-frame",
            projectId: "job",
            startDate: null,
            targetDate: day("2026-11-12"),
          },
        ];
      // The project's whole sequence, for the re-plan.
      return [
        {
          actualDate: day("2026-11-12"),
          estimatedDays: 2,
          id: "job-slab",
          startDate: day("2026-11-10"),
          status: MS.DONE,
          targetDate: day("2026-11-10"),
        },
        {
          actualDate: null,
          estimatedDays: 3,
          id: "job-frame",
          startDate: null,
          status: MS.PENDING,
          targetDate: day("2026-11-12"),
        },
        {
          actualDate: null,
          estimatedDays: 2,
          id: "job-roof",
          startDate: null,
          status: MS.PENDING,
          targetDate: day("2026-11-14"),
        },
      ];
    },
  });

  const { affectedProjectIds } = await saveMilestoneTemplateWithEffects(
    adminPrincipal(),
    {
      revision: templateRevision(rows),
      activities: [{ ...rows[0], estimatedDays: 3 }, rows[1]],
    },
    recorder.transactionalDb,
  );
  // Reported so the save route can refresh that project's cached screens.
  assert.deepEqual(affectedProjectIds, ["job"]);

  const openReads = recorder.calls.filter(
    (call) =>
      call.operation === "milestone.findMany"
      && (call.args as { where: { templateId?: unknown } }).where.templateId,
  );
  // One read for every changed row, and only activities not yet completed.
  assert.equal(openReads.length, 1);
  assert.deepEqual((openReads[0].args as { where: unknown }).where, {
    status: { in: [MS.PENDING, MS.ACTIVE] },
    templateId: { in: ["frame"] },
  });

  const writes = recorder
    .writes()
    .filter((write) => write.operation === "milestone.updateMany")
    .map((write) => write.args);
  assert.deepEqual(writes, [
    { data: { estimatedDays: 3 }, where: { id: { in: ["job-frame"] } } },
    // Frame now runs three days from 12 Nov, so roof starts on the 15th.
    {
      data: { targetDate: day("2026-11-15") },
      where: { id: "job-roof", status: MS.PENDING },
    },
  ]);
});
