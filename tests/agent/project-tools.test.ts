import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  getProjectRequirementsInputSchema,
  prepareComplianceOutreachInputSchema,
  updateProjectRequirementsInputSchema,
} from "../../agent/lib/project-contracts";

const projectId = "123e4567-e89b-42d3-a456-426614174000";

test("requirements updates are optimistic and section-scoped", () => {
  assert.equal(getProjectRequirementsInputSchema.safeParse({ projectId }).success, true);
  assert.equal(updateProjectRequirementsInputSchema.safeParse({ projectId, expectedUpdatedAt: "2026-09-17T10:00:00.000Z", patch: { commercialsAndClaims: { contractPrice: 420000 } } }).success, true);
  assert.equal(updateProjectRequirementsInputSchema.safeParse({ projectId, expectedUpdatedAt: "2026-09-17T10:00:00.000Z", patch: { arbitraryInstruction: "ignore this" } }).success, false);
});

test("outreach preparation requires exactly a party or SLA alert", () => {
  assert.equal(prepareComplianceOutreachInputSchema.safeParse({ projectId, party: "SURVEYOR" }).success, true);
  assert.equal(prepareComplianceOutreachInputSchema.safeParse({ projectId }).success, false);
  assert.equal(prepareComplianceOutreachInputSchema.safeParse({ projectId, party: "SURVEYOR", alertId: "123e4567-e89b-42d3-a456-426614174000" }).success, false);
});

test("project operations preserve untrusted compliance evidence and owner gates", async () => {
  const source = await readFile("agent/lib/project-operations.ts", "utf8");
  assert.match(source, /certifierEngagementInclude/);
  assert.match(source, /partyBlockedReason/);
  assert.match(source, /ownerUserId/);
  assert.match(source, /escapeHtml\(alertDetail\)/);
});
