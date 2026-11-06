import assert from "node:assert/strict";
import { test } from "vitest";

import { PROJECT_DOCUMENT_ROWS } from "@/lib/domain/projects/documents";
import { projectDetailInclude } from "@/lib/domain/projects/queries";
import { missingFrom, source } from "../support/sql-contract";

// The project page's two reads are raw SQL that build their result as JSON
// (issue #411). See tests/support/sql-contract.ts for what this does and does
// not prove.

test("the project detail SQL returns every relation and field its include names", () => {
  const missing = missingFrom(
    source("lib/domain/projects/detail-read.ts"),
    { include: projectDetailInclude },
    // Read through Prisma alongside the SQL: the compliance module's shape.
    ["certifierEngagement"],
  );
  assert.deepEqual(missing, [], `Missing from detail-read.ts: ${missing}`);
});

test("the project documents SQL returns every relation and field its rows name", () => {
  const sql = source("lib/domain/projects/documents.ts");
  const missing = Object.values(PROJECT_DOCUMENT_ROWS).flatMap((args) =>
    missingFrom(sql, args),
  );
  assert.deepEqual(missing, [], `Missing from documents.ts: ${missing}`);
});

test("staff notes are read only for a caller who may see them", () => {
  // A customer can be served the project page. The notes must not be in
  // their payload at all, not merely hidden by the screen.
  const queries = source("lib/domain/projects/queries.ts");
  assert.match(
    queries,
    /readProjectDetailRow\(projectId, projectReadScope\(principal\), db, \{\s*milestoneNotes: canSeeMilestoneNotes\(principal\),\s*\}\)/,
  );
  const sql = source("lib/domain/projects/detail-read.ts");
  assert.match(
    sql,
    /options\.milestoneNotes\s*\?[\s\S]*?:\s*Prisma\.sql`'\[\]'::jsonb`/,
  );
});
