import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// reportTradieIncident is a Server Action that only proves sign-in, and it
// connected whatever file ids the browser sent to the new incident. That moved
// another project's or lead's File row onto the incident, and File.incidentId
// cascades on delete, so removing the incident removed the file. The module
// loads Prisma and Clerk, so this reads the source.

const source = readFileSync(join(process.cwd(), "lib/data/tradie-management.ts"), "utf8");

function reportBody(): string {
  const start = source.indexOf("export async function reportTradieIncident(");
  assert.ok(start >= 0, "reportTradieIncident not found");
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, "reportTradieIncident has no end");
  return source.slice(start, end);
}

test("an incident no longer connects file ids it was handed", () => {
  const body = reportBody();
  assert.doesNotMatch(body, /connect:/);
  assert.doesNotMatch(body, /files:\s*input\.fileIds/);
});

test("an incident attaches only the reporter's unattached uploads, or fails", () => {
  const body = reportBody();
  const attach = /tx\.file\.updateMany\(\{\s*where: \{([\s\S]*?)\},\s*data: \{ incidentId: incident\.id \},/.exec(body);
  assert.ok(attach, "the incident's files are not attached through a scoped updateMany");
  const where = attach[1];
  for (const clause of [
    /id: \{ in: fileIds \}/,
    /uploadedBy: user\.id/,
    /projectId: null/,
    /milestoneId: null/,
    /leadId: null/,
    /complianceDocumentId: null/,
    /incidentId: null/,
  ]) {
    assert.match(where, clause);
  }
  assert.match(body, /if \(attached\.count !== fileIds\.length\) \{\s*throw new Error\(/);
  assert.match(body, /const fileIds = \[\.\.\.new Set\(input\.fileIds \?\? \[\]\)\];/);
});
