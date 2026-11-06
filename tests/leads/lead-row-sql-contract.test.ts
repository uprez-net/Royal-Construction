import assert from "node:assert/strict";
import { test } from "vitest";

import { LEAD_ROW_INCLUDE } from "@/lib/domain/leads/row-read";
import { missingFrom, source } from "../support/sql-contract";

// Every lead read is one SQL statement building JSON (readLeadRows), and its
// contract is LEAD_ROW_INCLUDE, which the writes still load through Prisma.
// See tests/support/sql-contract.ts for what this does and does not prove;
// scripts/perf/compare-lead-read.ts diffs the two on every lead.

test("the lead row SQL returns every relation and field LEAD_ROW_INCLUDE names", () => {
  const missing = missingFrom(source("lib/domain/leads/row-read.ts"), {
    include: LEAD_ROW_INCLUDE,
  });
  assert.deepEqual(missing, [], `Missing from row-read.ts: ${missing}`);
});
