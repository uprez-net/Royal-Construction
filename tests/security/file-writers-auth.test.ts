import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PROJECT_STAFF_ROLES, canAttachToProject } from "../../lib/projects/project-access";

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

const PROJECT = { customerId: "c-1" };

test("staff may attach files to any project, as every project screen lets them", () => {
  // A site manager who is not this project's site manager still gets the
  // upload button, the milestone photo and the update form, and the writes
  // behind them accept the file. Refusing the upload only broke them.
  assert.equal(canAttachToProject({ role: "ADMIN" }, PROJECT), true);
  assert.equal(canAttachToProject({ role: "SITE_MANAGER" }, PROJECT), true);
  assert.equal(canAttachToProject({ role: "GUEST" }, PROJECT), true);
});

test("a customer may attach files only to their own project", () => {
  assert.equal(canAttachToProject({ role: "CUSTOMER", customerId: "c-1" }, PROJECT), true);
  assert.equal(canAttachToProject({ role: "CUSTOMER", customerId: "c-2" }, PROJECT), false);
  assert.equal(canAttachToProject({ role: "CUSTOMER", customerId: null }, PROJECT), false);
  assert.equal(canAttachToProject({ role: "CUSTOMER" }, PROJECT), false);
  // An unknown role is not staff.
  assert.equal(canAttachToProject({ role: "TRADIE", customerId: "c-1" }, PROJECT), false);
});

test("the upload staff roles are the roles that read every lead", () => {
  const access = read("lib/offer/access.ts");
  const declared = /const INTERNAL_ROLES = new Set<Role>\(\[([^\]]*)\]\)/.exec(access);
  assert.ok(declared, "INTERNAL_ROLES moved; point this test at it");
  const internal = declared[1].split(",").map((role) => role.trim().replace(/^Role\./, "")).sort();
  assert.deepEqual([...PROJECT_STAFF_ROLES].sort(), internal);
});

test("the upload route checks the lead and the project before issuing a token", () => {
  const before = between(upload, "onBeforeGenerateToken", "onUploadCompleted");
  assert.match(before, /const \{ isAuthenticated, userId \} = await auth\(\);/);
  assert.match(before, /assertCanAccessLead\(user, Number\(clientPayload\.leadId\)\)/);
  assert.match(
    before,
    /assertCanAttachToProject\(user, \{\s*projectId: clientPayload\.projectId,\s*milestoneId: clientPayload\.milestoneId,\s*\}\)/,
  );
  ordered(before, "assertCanAccessLead(", "assertCanAttachToProject(", "tokenPayload:");
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
    "assertCanAttachToProject(user, { projectId, milestoneId })",
    "await put(",
    "await saveFile(",
  );
  assert.match(tool, /saveFile\(\{\s*userId: user\.id,/);
});
