import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { PROJECT_DOCUMENT_ROWS } from "@/lib/domain/projects/documents";
import { projectDetailInclude } from "@/lib/domain/projects/queries";
import { REPO_ROOT } from "../support/repo-root";

// The project page's two reads are raw SQL that build their result as JSON
// (issue #411): one statement instead of Prisma's statement per relation per
// level. Their contract is still a Prisma include, which types the result.
//
// The risk is drift: a relation or a field added to the include and not to the
// SQL is simply missing on the page, with no error. So every key the include
// names must appear as a JSON key in the SQL. This cannot prove the two agree
// (scripts/perf/compare-project-read.ts diffs real results for that); it stops
// the change that forgot the other half.

const source = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

/** Every relation and selected field an include or select names. */
function namedKeys(args: unknown, path: string[] = []): string[][] {
  if (!args || typeof args !== "object") return [];
  const node = args as Record<string, unknown>;
  const fields = (node.include ?? node.select ?? node) as Record<
    string,
    unknown
  >;
  const keys: string[][] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "orderBy" || key === "where" || value === false) continue;
    keys.push([...path, key]);
    if (value && typeof value === "object") {
      keys.push(...namedKeys(value, [...path, key]));
    }
  }
  return keys;
}

function missingFrom(sql: string, args: unknown, skip: string[] = []) {
  return namedKeys(args)
    .filter((path) => !skip.includes(path[0]))
    .filter((path) => !sql.includes(`'${path.at(-1)}'`))
    .map((path) => path.join("."));
}

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
