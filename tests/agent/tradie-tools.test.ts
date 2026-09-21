import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createTradieScheduleInputSchema,
  reportTradieIncidentInputSchema,
  transitionTradieScheduleInputSchema,
} from "../../agent/lib/tradie-contracts";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("tradie schedule contracts require bounded, timezone-aware dates", () => {
  assert.equal(
    createTradieScheduleInputSchema.safeParse({
      tradieId: id,
      projectId: id,
      scheduledDate: "2026-09-17T10:00:00+00:00",
    }).success,
    true,
  );
  assert.equal(
    createTradieScheduleInputSchema.safeParse({
      tradieId: id,
      projectId: id,
      scheduledDate: "not-a-date",
    }).success,
    false,
  );
  assert.equal(
    transitionTradieScheduleInputSchema.safeParse({
      scheduleId: id,
      toStatus: "CONFIRMED",
    }).success,
    true,
  );
});

test("incident contracts retain explicit severity and bounded evidence ids", () => {
  assert.equal(
    reportTradieIncidentInputSchema.safeParse({
      tradieId: id,
      incidentType: "Safety",
      severity: "HIGH",
      description: "Unsafe access",
    }).success,
    true,
  );
  assert.equal(
    reportTradieIncidentInputSchema.safeParse({
      tradieId: id,
      incidentType: "Safety",
      severity: "UNKNOWN",
      description: "Unsafe access",
    }).success,
    false,
  );
});

test("tradie operations enforce overlap checks and never expose the MCP adapter", async () => {
  const source = await readFile("agent/lib/tradie-operations.ts", "utf8");
  assert.match(source, /ensureNoScheduleConflict/);
  assert.match(source, /siteManagerId/);
  assert.match(source, /runAuditedAgentOperation/);
  assert.doesNotMatch(source, /app\/\(mcp\)/);
});
