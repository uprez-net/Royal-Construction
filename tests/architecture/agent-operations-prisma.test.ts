import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { ROOT, valueSpecifiers } from "./module-graph";

// Eve's specialist operation files may not carry a second implementation of a
// business rule (issue #301). Today they carry about 4,849 lines of one: the
// same lead, offer, project, tradie and admin rules that lib/data implements
// for the app, written again against Prisma directly. The package-boundary
// test proves Eve's copy loads. Nothing proved it agreed — and a quoted price
// or a signing state that agrees in the app and not in Eve is the expensive
// kind of wrong here, because a customer sees it.
//
// The end state is zero: every one of these files parses its contract, reads
// the actor from ctx.session.auth.current, wraps the mutation in
// runAuditedAgentOperation, and calls the same lib/domain command the App
// adapter calls.
//
// Until the phases land this is a ratchet, not a wall. Each file has a budget
// equal to what it had when the budget was written, and the budget may only go
// down. Migrating a command lowers it; adding a new direct query to a
// specialist fails immediately, with the model and line named.
//
// Agent infrastructure is a different thing and is exempt by model, not by
// file: session lookup, operation/idempotency records, audit rows and event
// persistence are Eve's own state, not the construction business's.

const AGENT_LIB = join(ROOT, "agent", "lib");

const PRISMA_OPERATIONS = new Set([
  "aggregate",
  "count",
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
  "update",
  "updateMany",
  "upsert",
]);

// Eve's own bookkeeping. A specialist touching these is infrastructure, not a
// duplicated business rule.
const AGENT_INFRASTRUCTURE_MODELS = new Set([
  "agentActionAudit",
  "agentAnnotation",
  "agentEvent",
  "agentFile",
  "agentOperation",
  "agentProfileMemory",
  "agentSession",
]);

/**
 * Direct Prisma access to a business model, in source order.
 *
 * Matches `<anything>.<model>.<operation>(…)` — `prisma.offer.update`,
 * `tx.lead.findUnique`, `db.tradieSchedule.create` — which is every shape
 * these files use. The receiver is deliberately not checked: renaming the
 * handle should not buy an exemption.
 */
function businessModelAccesses(
  file: string,
): { model: string; operation: string; line: number }[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: { model: string; operation: string; line: number }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression)
    ) {
      const operation = node.expression.name.text;
      const model = node.expression.expression.name.text;
      if (
        PRISMA_OPERATIONS.has(operation) &&
        !AGENT_INFRASTRUCTURE_MODELS.has(model)
      ) {
        found.push({
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          model,
          operation,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

// The budget each specialist had when this test was written. Lower a number
// when a command moves to lib/domain; never raise one. Zero means the file is
// migrated and must stay migrated.
const BUDGET: Record<string, number> = {
  "agent/lib/admin-operations.ts": 4,
  "agent/lib/lead-operations.ts": 0,
  "agent/lib/offer-operations.ts": 21,
  "agent/lib/project-operations.ts": 25,
  "agent/lib/tradie-operations.ts": 8,
};

function specialistFiles(): string[] {
  return readdirSync(AGENT_LIB)
    .filter((name) => name.endsWith("-operations.ts"))
    .map((name) => join(AGENT_LIB, name))
    .sort();
}

function repoPath(file: string): string {
  return relative(ROOT, file).split("\\").join("/");
}

test("every Eve specialist has a direct-Prisma budget", () => {
  const found = specialistFiles().map(repoPath).sort();
  assert.deepEqual(
    found,
    Object.keys(BUDGET).sort(),
    "A new agent/lib/*-operations.ts file needs a budget here. A brand-new specialist should be written against lib/domain and start at 0.",
  );
});

test("no Eve specialist exceeds its direct-Prisma budget", () => {
  const over: string[] = [];

  for (const file of specialistFiles()) {
    const path = repoPath(file);
    const accesses = businessModelAccesses(file);
    const budget = BUDGET[path] ?? 0;
    if (accesses.length <= budget) continue;

    // Only the tail past the budget is listed. A full dump of a thirty-query
    // file buries the one query that was just added.
    const detail = accesses
      .slice(budget)
      .map(
        ({ line, model, operation }) =>
          `    ${path}:${line} ${model}.${operation}`,
      )
      .join("\n");
    over.push(
      `${path}: ${accesses.length} direct business-model queries, budget ${budget}.\n${detail}`,
    );
  }

  assert.deepEqual(
    over,
    [],
    `A specialist gained direct Prisma access. Call the lib/domain command the App adapter calls instead (lib/domain/README.md):\n\n${over.join(
      "\n\n",
    )}\n`,
  );
});

test("the budget is tight: lower it when a command moves to lib/domain", () => {
  const slack: string[] = [];

  for (const file of specialistFiles()) {
    const path = repoPath(file);
    const actual = businessModelAccesses(file).length;
    const budget = BUDGET[path] ?? 0;
    if (actual < budget) {
      slack.push(
        `${path}: budget ${budget}, actual ${actual} — lower it to ${actual}.`,
      );
    }
  }

  assert.deepEqual(
    slack,
    [],
    `The ratchet only works if it stays tight:\n  ${slack.join("\n  ")}\n`,
  );
});

test("a fully migrated specialist stops importing prisma", () => {
  const stragglers: string[] = [];

  for (const file of specialistFiles()) {
    const path = repoPath(file);
    if (businessModelAccesses(file).length > 0) continue;
    if (valueSpecifiers(file).includes("@/lib/prisma")) {
      stragglers.push(path);
    }
  }

  assert.deepEqual(
    stragglers,
    [],
    `These specialists issue no business queries but still import @/lib/prisma. Drop the import:\n  ${stragglers.join(
      "\n  ",
    )}\n`,
  );
});
