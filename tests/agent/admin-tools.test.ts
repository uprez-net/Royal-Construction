import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  resolveApprovalInputSchema,
  updateAdminContentInputSchema,
  updateTeamRoleInputSchema,
} from "../../agent/lib/admin-contracts";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("admin approval contracts require safe resolution details", () => {
  assert.equal(
    resolveApprovalInputSchema.safeParse({
      approvalId: id,
      resolution: "approved",
    }).success,
    true,
  );
  assert.equal(
    resolveApprovalInputSchema.safeParse({
      approvalId: id,
      resolution: "rejected",
    }).success,
    false,
  );
  assert.equal(
    resolveApprovalInputSchema.safeParse({
      approvalId: id,
      resolution: "rejected",
      rejectionReason: "Insufficient evidence",
    }).success,
    true,
  );
});

test("the agent cannot write an allowance with a blank variation rule", () => {
  // The page action uses offerScopeWriteSchema. The /agent tool writes the
  // same JSON through updateAdminContentInputSchema; a blank rule here would
  // copy onto every new offer the same way #266 did from the editor.
  const result = updateAdminContentInputSchema.safeParse({
    section: "offerScope",
    expectedVersion: 1,
    data: {
      allowances: [
        {
          id: "alw-1",
          name: "Ground floor ceiling upgrade",
          category: "package",
          amount: 4500,
          variationRule: "",
        },
      ],
      exclusions: [],
    },
  });
  assert.equal(result.success, false);
});

test("admin content and team contracts are bounded", () => {
  assert.equal(
    updateAdminContentInputSchema.safeParse({
      section: "buildScope",
      expectedVersion: 1,
      data: ["Site preparation"],
    }).success,
    true,
  );
  assert.equal(
    updateAdminContentInputSchema.safeParse({
      section: "buildScope",
      expectedVersion: 1,
      data: "not-an-array",
    }).success,
    false,
  );
  assert.equal(
    updateTeamRoleInputSchema.safeParse({ userId: id, newRole: "ADMIN" })
      .success,
    true,
  );
});

test("admin operations enforce admin authorization and audited writes", async () => {
  const source = await readFile("agent/lib/admin-operations.ts", "utf8");
  assert.match(source, /requireAdmin/);
  assert.match(source, /runAuditedAgentOperation/);
  assert.match(source, /revokeToken/);
  assert.doesNotMatch(source, /(?:accessToken|refreshToken)\s*[:=]/);
  assert.doesNotMatch(source, /app\/\(mcp\)/);
});

test("the agent offer-scope write uses the write schema", async () => {
  const source = await readFile("agent/lib/admin-operations.ts", "utf8");
  const fn = source.slice(
    source.indexOf("export async function updateAuthorizedAdminContent"),
    source.indexOf("export async function listAuthorizedTeam"),
  );
  assert.match(fn, /offerScopeWriteSchema\.safeParse/);
  assert.equal(fn.includes("offerScopeDataSchema"), false);
});
