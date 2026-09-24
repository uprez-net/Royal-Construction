import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  getProjectRequirementsInputSchema,
  prepareComplianceOutreachInputSchema,
  updateProjectRequirementsInputSchema,
} from "@/agent/lib/project-contracts";

const projectId = "123e4567-e89b-42d3-a456-426614174000";

test("requirements updates are optimistic and section-scoped", () => {
  assert.equal(
    getProjectRequirementsInputSchema.safeParse({ projectId }).success,
    true,
  );
  assert.equal(
    updateProjectRequirementsInputSchema.safeParse({
      projectId,
      expectedUpdatedAt: "2026-09-17T10:00:00.000Z",
      patch: { commercialsAndClaims: { totalContractSum: 420000 } },
    }).success,
    true,
  );
  assert.equal(
    updateProjectRequirementsInputSchema.safeParse({
      projectId,
      expectedUpdatedAt: "2026-09-17T10:00:00.000Z",
      patch: { arbitraryInstruction: "ignore this" },
    }).success,
    false,
  );
});

test("outreach preparation requires exactly a party or SLA alert", () => {
  assert.equal(
    prepareComplianceOutreachInputSchema.safeParse({
      projectId,
      party: "SURVEYOR",
    }).success,
    true,
  );
  assert.equal(
    prepareComplianceOutreachInputSchema.safeParse({ projectId }).success,
    false,
  );
  assert.equal(
    prepareComplianceOutreachInputSchema.safeParse({
      projectId,
      party: "SURVEYOR",
      alertId: "123e4567-e89b-42d3-a456-426614174000",
    }).success,
    false,
  );
});

test("project operations preserve untrusted compliance evidence and owner gates", async () => {
  const source = await readFile("agent/lib/project-operations.ts", "utf8");
  // The compliance read shape, the prerequisite gate and the outreach body all
  // moved to lib/domain/compliance/ (issue #301) so the App routes and the cron
  // get them too. What this file must still do is reach those commands rather
  // than assemble an engagement read or an outreach email of its own.
  assert.match(source, /@\/lib\/domain\/compliance\//);
  assert.doesNotMatch(source, /certifierEngagementInclude/);
  assert.doesNotMatch(source, /prisma\.certifierEngagement/);
  assert.match(source, /ownerUserId/);
});

test("the outreach body still escapes an alert detail nobody here wrote", async () => {
  // A party outreach email is the customer-visible end of this path and the
  // alert detail on it can come from an inbound message. It is interpolated
  // into HTML, so the escape is the whole defence; it must not be lost in the
  // move to the domain.
  const outreach = await readFile("lib/domain/compliance/outreach.ts", "utf8");
  assert.match(outreach, /escapeHtml\(alertDetail\)/);
  assert.match(outreach, /escapeHtml\(subjectAddress\)/);
  assert.match(outreach, /partyBlockedReason/);
});
