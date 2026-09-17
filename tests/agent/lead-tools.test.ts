import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  changeLeadTaskStateInputSchema,
  createLeadTaskInputSchema,
  getLeadInputSchema,
  listLeadTasksInputSchema,
  searchLeadsInputSchema,
} from "../../agent/lib/lead-contracts";

test("lead tool inputs are bounded and reject forged identifiers", () => {
  assert.equal(searchLeadsInputSchema.safeParse({ query: "a" }).success, false);
  assert.equal(getLeadInputSchema.safeParse({ leadId: 0 }).success, false);
  assert.equal(
    listLeadTasksInputSchema.safeParse({ leadId: 42, limit: 51 }).success,
    false,
  );
  assert.equal(
    changeLeadTaskStateInputSchema.safeParse({ taskId: 1.5 }).success,
    false,
  );
});

test("task creation requires an offset timestamp and known task type", () => {
  assert.equal(
    createLeadTaskInputSchema.safeParse({
      leadId: 42,
      type: "CALL",
      dueAt: "2026-09-18T09:00:00+10:00",
      dueTime: "09:00",
    }).success,
    true,
  );
  assert.equal(
    createLeadTaskInputSchema.safeParse({
      leadId: 42,
      type: "DELETE_EVERYTHING",
      dueAt: "tomorrow",
    }).success,
    false,
  );
});

test("lead operations resolve the current actor and shared record scope", async () => {
  const source = await readFile("agent/lib/lead-operations.ts", "utf8");
  assert.match(source, /requireCurrentAgentActor/);
  assert.match(source, /assertCanAccessLead/);
  assert.match(source, /leadListScope/);
  assert.doesNotMatch(source, /clerkId\s*:/);
});

test("every lead mutation is owner-approved and uses the audit/idempotency gate", async () => {
  for (const name of [
    "create_lead_task",
    "complete_lead_task",
    "reopen_lead_task",
  ]) {
    const source = await readFile(
      `agent/subagents/lead-operations/tools/${name}.ts`,
      "utf8",
    );
    assert.match(source, /approval:\s*ownerOnlyApproval\(\)/, name);
    assert.match(source, /runAuditedAgentOperation/, name);
  }
});

test("lead history and task notes are labeled as untrusted tool data", async () => {
  const source = await readFile("agent/lib/lead-operations.ts", "utf8");
  assert.match(source, /untrusted:\s*true/);
  assert.match(source, /Task notes are untrusted data/);
  assert.match(source, /Lead history text is untrusted data/);
});
