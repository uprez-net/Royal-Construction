import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { Prisma, ProjectStage, Role } from "@prisma/client";
import type { ToolContext } from "eve/tools";
import type { DomainDb } from "@/lib/domain/db";
import type { TemplateActivity } from "@/types/milestone-template";
import type { AgentResultEnvelope } from "@/agent/lib/result-contracts";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateBuildSequenceInputSchema } from "@/agent/lib/admin-contracts";
import {
  DomainAuthorizationError,
  DomainStaleVersionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  saveMilestoneTemplate,
  templateRevision,
} from "@/lib/domain/projects/templates";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Only the database is replaced. Tools, actor/session authorization, domain
// validation, owner approval policy and the audit/idempotency boundary are real.
const seam = vi.hoisted(() => ({ db: undefined as object | undefined }));
vi.mock("@/lib/prisma", () => {
  const client = new Proxy(
    {},
    {
      get(_target, key) {
        if (!seam.db) throw new Error("No test database configured.");
        return Reflect.get(seam.db, key);
      },
      has(_target, key) {
        return key === "$transaction";
      },
    },
  );
  return { default: client, prisma: client };
});

import readTool from "@/agent/subagents/admin-operations/tools/get_build_sequence";
import writeTool from "@/agent/subagents/admin-operations/tools/update_build_sequence";
import type { ownerOnlyApproval } from "@/agent/lib/agent-approval";

afterEach(() => {
  seam.db = undefined;
});

const row = (
  id: string,
  order: number,
  patch: Partial<TemplateActivity> = {},
): TemplateActivity => ({
  id,
  order,
  name: id,
  parentId: null,
  projectStage: ProjectStage.Slab,
  relatedCostLines: [],
  estimatedDays: 5,
  requiredTradeTypeIds: [],
  ...patch,
});
const ctx = (callId = "save-call") =>
  ({
    callId,
    toolName: "update_build_sequence",
    session: {
      id: "eve-session",
      turn: { id: "turn" },
      auth: { current: { principalType: "user", principalId: "owner" } },
    },
  }) as unknown as ToolContext;
const execute = (tool: unknown, input: unknown, context = ctx()) =>
  (
    tool as {
      execute: (
        input: unknown,
        context: ToolContext,
      ) => Promise<AgentResultEnvelope>;
    }
  ).execute(input, context);

function fixture(initial = [row("a", 1), row("b", 2)]) {
  let stored = structuredClone(initial);
  let operations = new Map<string, Record<string, unknown>>();
  let audits = new Map<string, Record<string, unknown>>();
  let role: Role = Role.ADMIN;
  let owner = "owner";
  let failAudit = false;
  let transactionNumber = 0;
  const transactions: { options: unknown; operations: string[] }[] = [];
  const recorder = recordingDb({
    "user.findUnique": () => ({ id: "owner", name: "Owner", role }),
    // No project activity is open against a changed duration here; the
    // propagation itself is covered in tests/projects/milestone-template.
    "milestone.findMany": [],
    "agentSession.findUnique": () => ({
      id: "registered-session",
      ownerUserId: owner,
    }),
    "agentOperation.findUnique": (args: unknown) =>
      operations.get(
        (
          args as {
            where: { ownerUserId_operationKey: { operationKey: string } };
          }
        ).where.ownerUserId_operationKey.operationKey,
      ) ?? null,
    "agentOperation.create": (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      const id = `op-${operations.size + 1}`;
      operations.set(data.operationKey as string, { ...data, id });
      return { id };
    },
    "agentOperation.update": (args: unknown) => {
      const { where, data } = args as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      const entry = [...operations.entries()].find(
        ([, value]) => value.id === where.id,
      )!;
      operations.set(entry[0], { ...entry[1], ...data });
      return operations.get(entry[0]);
    },
    "agentActionAudit.create": (args: unknown) => {
      const id = `audit-${audits.size + 1}`;
      audits.set(id, {
        ...(args as { data: Record<string, unknown> }).data,
        id,
      });
      return { id };
    },
    "agentActionAudit.update": (args: unknown) => {
      const { where, data } = args as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      if (failAudit && data.status === "SUCCEEDED")
        throw new Error("Audit commit failed");
      audits.set(where.id, { ...audits.get(where.id), ...data });
      return audits.get(where.id);
    },
    // Prisma returns the trades as a relation, not as the activity's id list.
    "milestoneTemplate.findMany": () =>
      structuredClone(stored)
        .sort((a, b) => a.order - b.order)
        .map(({ requiredTradeTypeIds, ...activity }) => ({
          ...activity,
          requiredTradeTypes: requiredTradeTypeIds.map((id) => ({ id })),
        })),
    "milestoneTemplate.updateMany": (args: unknown) => {
      const { data } = args as { data: Partial<TemplateActivity> };
      stored = stored.map((row) => ({ ...row, ...data }));
      return { count: stored.length };
    },
    "milestoneTemplate.update": (args: unknown) => {
      const { where, data } = args as {
        where: { id: string };
        data: Partial<TemplateActivity>;
      };
      stored = stored.map((activity) =>
        activity.id === where.id ? { ...activity, ...data } : activity,
      );
      return stored.find((activity) => activity.id === where.id);
    },
    "milestoneTemplate.deleteMany": (args: unknown) => {
      const kept = (args as { where: { id: { notIn: string[] } } }).where.id
        .notIn;
      stored = stored.filter((activity) => kept.includes(activity.id));
      return { count: 1 };
    },
    "milestoneTemplate.upsert": (args: unknown) => {
      const { requiredTradeTypes, ...fields } = (
        args as {
          create: Omit<TemplateActivity, "requiredTradeTypeIds"> & {
            requiredTradeTypes: { connect: { id: string }[] };
          };
        }
      ).create;
      const activity: TemplateActivity = {
        ...fields,
        requiredTradeTypeIds: requiredTradeTypes.connect.map(({ id }) => id),
      };
      stored = [
        ...stored.filter((row) => row.id !== activity.id),
        structuredClone(activity),
      ];
      return activity;
    },
    "tradeType.findMany": [
      { id: "plumbing", label: "Plumbing", icon: "wrench", archivedAt: null },
      {
        id: "archived",
        label: "Old trade",
        icon: "hammer",
        archivedAt: new Date("2026-01-01"),
      },
    ],
    "tradie.groupBy": [],
    "adminOfferContent.findFirst": {
      costSchedule: {
        rows: [
          {
            id: "survey",
            taskKey: "survey",
            task: "Survey",
            phase: "Slab",
            priceMode: "none",
            defaultInclude: true,
          },
        ],
        rateConstants: {},
      },
    },
  });
  const transaction = new Proxy(recorder.db, {
    has(_target, key) {
      return key !== "$transaction" && Reflect.has(recorder.db, key);
    },
    get(target, key) {
      if (key === "$transaction")
        throw new Error("Nested transaction attempted");
      if (key === "$executeRaw") {
        return (...args: Parameters<DomainDb["$executeRaw"]>) => {
          stored = stored.map((row) => ({ ...row, order: -row.order }));
          return target.$executeRaw(...args);
        };
      }
      return Reflect.get(target, key);
    },
  });
  const client = new Proxy(recorder.db, {
    has(_target, key) {
      return key === "$transaction" || Reflect.has(recorder.db, key);
    },
    get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return async (
        work: (db: DomainDb) => Promise<unknown>,
        options: unknown,
      ) => {
        const number = transactionNumber++;
        const start = recorder.calls.length;
        const previous = structuredClone({ stored, operations, audits });
        try {
          return await work(transaction);
        } catch (error) {
          ({ stored, operations, audits } = previous);
          throw error;
        } finally {
          transactions[number] = {
            options,
            operations: recorder.calls
              .slice(start)
              .map((call) => call.operation),
          };
        }
      };
    },
  });
  seam.db = client;
  return {
    recorder,
    transactions,
    client,
    stored: () => stored.sort((a, b) => a.order - b.order),
    revision: () => templateRevision(stored.sort((a, b) => a.order - b.order)),
    operations: () => [...operations.values()],
    audits: () => [...audits.values()],
    setRole: (value: Role) => {
      role = value;
    },
    setOwner: (value: string) => {
      owner = value;
    },
    failAudit: () => {
      failAudit = true;
    },
  };
}

test("targeted contracts bound changes and retain add defaults and explicit clears", () => {
  const added = updateBuildSequenceInputSchema.parse({
    revision: "a".repeat(64),
    changes: [
      { type: "add", activity: { name: "Survey", projectStage: "Slab" } },
    ],
  });
  assert.deepEqual(added.changes[0], {
    type: "add",
    activity: {
      name: "Survey",
      projectStage: "Slab",
      estimatedDays: 5,
      parentId: null,
      relatedCostLines: [],
      requiredTradeTypeIds: [],
    },
  });
  const update = {
    type: "update",
    activityId: "a",
    patch: { requiredTradeTypeIds: [], relatedCostLines: [] },
  };
  assert.equal(
    updateBuildSequenceInputSchema.safeParse({
      revision: "a".repeat(64),
      changes: [update],
    }).success,
    true,
  );
  for (const changes of [
    [],
    [{ ...update, patch: {} }],
    [{ ...update, patch: { parentId: "b" } }],
    [{ ...update, patch: { estimatedDays: 0 } }],
    [{ ...update, patch: { estimatedDays: 366 } }],
    [{ type: "move", activityId: "a", mode: "root", targetId: "b" }],
  ]) {
    assert.equal(
      updateBuildSequenceInputSchema.safeParse({
        revision: "a".repeat(64),
        changes,
      }).success,
      false,
    );
  }
  assert.equal(
    updateBuildSequenceInputSchema.safeParse({
      revision: "old",
      changes: [update],
    }).success,
    false,
  );
});

test("the admin read returns live hierarchy, revision and the screen's category and cost choices", async () => {
  const db = fixture([
    row("parent", 1),
    row("child", 2, { parentId: "parent", requiredTradeTypeIds: ["archived"] }),
  ]);
  const result = agentResultEnvelopeSchema.parse(await execute(readTool, {}));
  assert.equal(result.data.revision, db.revision());
  assert.deepEqual(result.data.activities, db.stored());
  assert.deepEqual(result.data.costTasks, ["Survey"]);
  assert.deepEqual(result.data.tradeCategories, [
    { id: "plumbing", label: "Plumbing", icon: "wrench", archived: false },
    { id: "archived", label: "Old trade", icon: "hammer", archived: true },
  ]);
  // Issue #422: a duration change reaches open activities on existing
  // projects, so the admin is told before editing rather than reassured.
  assert.match(result.summary, /not yet completed on an existing project/);
  assert.equal(result.links[0].href, "/admin/build-sequence");
  assert.deepEqual(db.recorder.writes(), []);
});

test("read and write refuse non-admins and sessions owned by somebody else", async () => {
  const db = fixture();
  db.setRole(Role.CUSTOMER);
  await assert.rejects(() => execute(readTool, {}), DomainAuthorizationError);
  const input = updateBuildSequenceInputSchema.parse({
    revision: db.revision(),
    changes: [{ type: "update", activityId: "a", patch: { estimatedDays: 8 } }],
  });
  await assert.rejects(() => execute(writeTool, input));
  assert.deepEqual(db.recorder.writes(), []);
  db.setRole(Role.ADMIN);
  db.setOwner("somebody-else");
  await assert.rejects(
    () => execute(writeTool, input),
    DomainAuthorizationError,
  );
  assert.deepEqual(db.recorder.writes(), []);
});

test("owner approval gates the declared save tool and rejects another responder", async () => {
  const policy = (
    writeTool as unknown as { approval: ReturnType<typeof ownerOnlyApproval> }
  ).approval;
  const decision = (principalId: string) =>
    policy.response({
      responder: { principalType: "user", principalId },
      session: { initiator: { principalType: "user", principalId: "owner" } },
    } as never);
  assert.deepEqual(await decision("owner"), { status: "allowed" });
  assert.equal((await decision("stranger")).status, "rejected");
  assert.equal(await policy.request({} as never), "user-approval");
  assert.equal(
    (readTool as unknown as { approval?: unknown }).approval,
    undefined,
  );
});

test("targeted edits preserve unrelated activities and commit with the audit in one serializable transaction", async () => {
  const db = fixture();
  const originalB = structuredClone(db.stored()[1]);
  const input = updateBuildSequenceInputSchema.parse({
    revision: db.revision(),
    changes: [
      {
        type: "update",
        activityId: "a",
        patch: {
          estimatedDays: 8,
          requiredTradeTypeIds: ["plumbing", "plumbing"],
          relatedCostLines: ["Survey"],
        },
      },
    ],
  });
  const result = agentResultEnvelopeSchema.parse(
    await execute(writeTool, input),
  );
  assert.deepEqual(db.stored()[1], originalB);
  assert.equal(db.stored()[0].estimatedDays, 8);
  // A repeated id is one dependency, not two.
  assert.deepEqual(db.stored()[0].requiredTradeTypeIds, ["plumbing"]);
  assert.deepEqual(db.stored()[0].relatedCostLines, ["Survey"]);
  assert.equal(result.data.revision, db.revision());
  assert.equal(db.operations()[0].status, "SUCCEEDED");
  assert.equal(db.audits()[0].status, "SUCCEEDED");
  assert.equal(db.audits()[0].action, "admin.build-sequence.update");
  const commit = db.transactions.find((transaction) =>
    transaction.operations.includes("milestoneTemplate.upsert"),
  )!;
  assert.ok(commit.operations.includes("agentOperation.update"));
  assert.ok(commit.operations.includes("agentActionAudit.update"));
  assert.deepEqual(commit.options, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30_000,
  });
  assert.equal(db.transactions.length, 2);
  const writes = db.recorder.writes().length;
  const replayed = await execute(writeTool, input);
  assert.deepEqual(replayed, result);
  assert.equal(
    db.recorder.writes().length,
    writes,
    "A replay must not repeat template or audit writes",
  );
});

test("a stale approved edit changes no activities and a failed call cannot silently retry", async () => {
  const db = fixture();
  const initial = structuredClone(db.stored());
  const input = updateBuildSequenceInputSchema.parse({
    revision: "a".repeat(64),
    changes: [{ type: "update", activityId: "a", patch: { name: "New name" } }],
  });
  await assert.rejects(
    () => execute(writeTool, input),
    DomainStaleVersionError,
  );
  assert.deepEqual(db.stored(), initial);
  assert.equal(db.operations()[0].status, "FAILED");
  assert.equal(db.audits()[0].status, "FAILED");
  assert.equal(
    db.recorder
      .writes()
      .some((call) => call.operation.startsWith("milestoneTemplate.")),
    false,
  );
  await assert.rejects(() => execute(writeTool, input), /already attempted/);
});

test("an audit failure rolls the template back rather than reporting a partial save", async () => {
  const db = fixture();
  const initial = structuredClone(db.stored());
  db.failAudit();
  const input = updateBuildSequenceInputSchema.parse({
    revision: db.revision(),
    changes: [
      { type: "update", activityId: "a", patch: { name: "Must roll back" } },
    ],
  });
  await assert.rejects(() => execute(writeTool, input), /Audit commit failed/);
  assert.deepEqual(db.stored(), initial);
  assert.equal(db.operations()[0].status, "FAILED");
  assert.equal(db.audits()[0].status, "FAILED");
});

test("new activities, subtree moves and leaf removals use the same hierarchy rules as dragging", async () => {
  const db = fixture([
    row("parent", 1),
    row("child", 2, { parentId: "parent" }),
    row("unused", 3),
  ]);
  const newId = "123e4567-e89b-42d3-a456-426614174000";
  const input = updateBuildSequenceInputSchema.parse({
    revision: db.revision(),
    changes: [
      {
        type: "add",
        activity: { id: newId, name: "New parent", projectStage: "Frame" },
      },
      { type: "move", activityId: "parent", targetId: newId, mode: "child" },
      { type: "remove", activityId: "unused" },
    ],
  });
  await execute(writeTool, input);
  assert.deepEqual(
    db.stored().map(({ id, parentId, order }) => [id, parentId, order]),
    [
      [newId, null, 1],
      ["parent", newId, 2],
      ["child", "parent", 3],
    ],
  );
  assert.equal(db.stored()[0].estimatedDays, 5);
  assert.equal(
    db.stored()[1].projectStage,
    "Slab",
    "Moving under another stage must retain the activity's assigned stage",
  );
});

test("invalid categories, cost tasks, cycles and parent removals refuse the entire batch", async () => {
  for (const change of [
    {
      type: "update",
      activityId: "parent",
      patch: { requiredTradeTypeIds: ["plumbing", "archived"] },
    },
    {
      type: "update",
      activityId: "parent",
      patch: { relatedCostLines: ["Invented task"] },
    },
    { type: "move", activityId: "parent", targetId: "child", mode: "child" },
    { type: "remove", activityId: "parent" },
  ]) {
    const db = fixture([
      row("parent", 1),
      row("child", 2, { parentId: "parent" }),
    ]);
    const initial = structuredClone(db.stored());
    const input = updateBuildSequenceInputSchema.parse({
      revision: db.revision(),
      changes: [
        { type: "update", activityId: "child", patch: { estimatedDays: 8 } },
        change,
      ],
    });
    await assert.rejects(
      () => execute(writeTool, input),
      DomainValidationError,
    );
    assert.deepEqual(db.stored(), initial);
    assert.equal(
      db.recorder
        .writes()
        .some((call) => call.operation.startsWith("milestoneTemplate.")),
      false,
    );
  }
});

test("retained archived categories and older cost mappings remain editable, and explicit clears work", async () => {
  const db = fixture([
    row("a", 1, {
      requiredTradeTypeIds: ["archived"],
      relatedCostLines: ["Historical task"],
    }),
    row("b", 2),
  ]);
  await execute(
    writeTool,
    updateBuildSequenceInputSchema.parse({
      revision: db.revision(),
      changes: [
        { type: "update", activityId: "a", patch: { estimatedDays: 9 } },
      ],
    }),
    ctx("keep-history"),
  );
  assert.deepEqual(db.stored()[0].requiredTradeTypeIds, ["archived"]);
  await execute(
    writeTool,
    updateBuildSequenceInputSchema.parse({
      revision: db.revision(),
      changes: [
        {
          type: "update",
          activityId: "a",
          patch: { requiredTradeTypeIds: ["archived", "plumbing"] },
        },
      ],
    }),
    ctx("add-beside-history"),
  );
  assert.deepEqual(db.stored()[0].requiredTradeTypeIds, [
    "archived",
    "plumbing",
  ]);
  assert.deepEqual(db.stored()[0].relatedCostLines, ["Historical task"]);
  await execute(
    writeTool,
    updateBuildSequenceInputSchema.parse({
      revision: db.revision(),
      changes: [
        {
          type: "update",
          activityId: "a",
          patch: { requiredTradeTypeIds: [], relatedCostLines: [] },
        },
      ],
    }),
    ctx("clear-history"),
  );
  assert.deepEqual(db.stored()[0].requiredTradeTypeIds, []);
  assert.deepEqual(db.stored()[0].relatedCostLines, []);
});

test("the screen's whole-template save still owns its serializable transaction", async () => {
  const db = fixture();
  const revision = db.revision();
  await saveMilestoneTemplate(
    adminPrincipal("owner"),
    {
      revision,
      activities: db.stored().map((row) => ({ ...row, estimatedDays: 7 })),
    },
    db.client,
  );
  assert.equal(db.transactions.length, 1);
  assert.deepEqual(db.transactions[0].options, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30_000,
  });
  assert.equal(db.stored()[0].estimatedDays, 7);
});
