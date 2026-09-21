import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// reportTradieIncident connected whatever file ids the browser sent to the new
// incident. That moved another project's or lead's File row onto the incident,
// and File.incidentId cascades on delete, so removing the incident removed the
// file.
//
// The rule moved to lib/domain/tradies/incidents.ts (issue #301 phase 6),
// where Eve's incident tool now calls it too — its own copy matched on
// `uploadedBy` alone and had exactly the bug this test was written to catch.
//
// Line endings are normalised because the scan below looks for a newline, and
// a Windows checkout with core.autocrlf=true writes CRLF.

const source = readFileSync(
  join(process.cwd(), "lib/domain/tradies/incidents.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

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
  // Anchored on the file write itself, so the tradie lookup's own `where`
  // cannot satisfy it. Key order is prettier's, not ours.
  const attach =
    /tx\.file\.updateMany\(\{\s*data: \{ incidentId: incident\.id \},\s*where: \{([\s\S]*?)\n {8}\},/.exec(
      body,
    );
  assert.ok(
    attach,
    "the incident's files are not attached through a scoped updateMany",
  );
  const where = attach[1];
  for (const clause of [
    /id: \{ in: fileIds \}/,
    /uploadedBy: reporterId/,
    /projectId: null/,
    /milestoneId: null/,
    /leadId: null/,
    /complianceDocumentId: null/,
    /incidentId: null/,
  ]) {
    assert.match(where, clause);
  }
  assert.match(
    body,
    /if \(attached\.count !== fileIds\.length\) \{\s*throw new DomainValidationError\(/,
  );
  assert.match(
    body,
    /const fileIds = \[\.\.\.new Set\(input\.fileIds \?\? \[\]\)\];/,
  );
});
