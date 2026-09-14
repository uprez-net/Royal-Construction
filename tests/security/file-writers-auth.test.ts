import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { canEditProject } from "../../lib/projects/project-access";

// saveFile writes a File row for whatever user, lead, project and milestone it
// is handed, so each user-facing caller has to derive the user and check the
// ids itself. /api/upload checked a lead but not a project or milestone, and
// the MCP upload_file tool checked neither and stored the token's Clerk id as
// File.uploadedBy, a column that references User.id. Both routes load Clerk and
// Prisma, so no test can import them; this reads the source.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const upload = read("app/api/upload/route.ts");
const mcp = read("app/(mcp)/api/mcp/route.ts");

function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `expected ${from}`);
  const end = text.indexOf(to, start);
  assert.ok(end > start, `expected ${to} after ${from}`);
  return text.slice(start, end);
}

function ordered(text: string, ...needles: string[]) {
  let last = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    assert.ok(at >= 0, `expected ${needle}`);
    assert.ok(at > last, `${needle} is out of order`);
    last = at;
  }
}

const ADMIN = { id: "u-admin", role: "ADMIN" };
const PROJECT = {
  customerId: "c-1",
  siteManagerId: "u-site",
  Lead: { assignedId: "u-sales" },
};

test("the project edit rule lets in the people who work on the project", () => {
  assert.equal(canEditProject(ADMIN, PROJECT), true);
  assert.equal(canEditProject({ id: "u-site", role: "SITE_MANAGER" }, PROJECT), true);
  assert.equal(canEditProject({ id: "u-sales", role: "GUEST" }, PROJECT), true);
  assert.equal(canEditProject({ id: "u-cust", role: "CUSTOMER", customerId: "c-1" }, PROJECT), true);
});

test("the project edit rule keeps everyone else out", () => {
  assert.equal(canEditProject({ id: "u-other", role: "SITE_MANAGER" }, PROJECT), false);
  assert.equal(canEditProject({ id: "u-other", role: "GUEST" }, PROJECT), false);
  assert.equal(canEditProject({ id: "u-cust", role: "CUSTOMER", customerId: "c-2" }, PROJECT), false);
  // A customer id only counts for a CUSTOMER, and a missing one matches nothing.
  assert.equal(canEditProject({ id: "u-x", role: "GUEST", customerId: "c-1" }, PROJECT), false);
  assert.equal(
    canEditProject(
      { id: "u-cust", role: "CUSTOMER", customerId: null },
      { ...PROJECT, siteManagerId: null, Lead: { assignedId: null } },
    ),
    false,
  );
});

test("the upload route checks the lead and the project before issuing a token", () => {
  const before = between(upload, "onBeforeGenerateToken", "onUploadCompleted");
  assert.match(before, /const \{ isAuthenticated, userId \} = await auth\(\);/);
  assert.match(before, /assertCanAccessLead\(user, Number\(clientPayload\.leadId\)\)/);
  assert.match(
    before,
    /assertCanEditProject\(user, \{\s*projectId: clientPayload\.projectId,\s*milestoneId: clientPayload\.milestoneId,\s*\}\)/,
  );
  ordered(before, "assertCanAccessLead(", "assertCanEditProject(", "tokenPayload:");
});

test("the completed upload is recorded as the session's user", () => {
  const after = between(upload, "onUploadCompleted", "return NextResponse.json");
  assert.match(after, /saveFile\(\{\s*userId: user\.id,/);
});

test("MCP upload_file resolves the User row and checks the project before storing", () => {
  const tool = between(mcp, '"upload_file"', "serverInfo");
  ordered(
    tool,
    "getUserByClerkIdCached(clerkId)",
    "assertCanEditProject(user, { projectId, milestoneId })",
    "await put(",
    "await saveFile(",
  );
  assert.match(tool, /saveFile\(\{\s*userId: user\.id,/);
});
