import assert from "node:assert/strict";
import { test } from "vitest";

import { parseLeadsTableReturn } from "@/components/leads/leads-table-return";

// Issue #350: coming back from a lead put the Leads table on page 1. The
// position is kept per tab in sessionStorage, which a person, an extension or
// an older build can leave holding anything, so a bad value must mean
// "start on page 1", never a crash or a nonsense request.

test("a saved position reads back whole", () => {
  const saved = {
    page: 4,
    query: "sandhu",
    metric: "lost",
    filterTiming: "30d",
  };
  assert.deepEqual(parseLeadsTableReturn(JSON.stringify(saved)), saved);
  assert.deepEqual(
    parseLeadsTableReturn(
      JSON.stringify({ ...saved, metric: null, query: "" }),
    ),
    { ...saved, metric: null, query: "" },
  );
});

test("nothing saved, or anything malformed, starts on page 1", () => {
  for (const raw of [
    null,
    "",
    "not json",
    "null",
    "[]",
    JSON.stringify({ page: 0, query: "", metric: null, filterTiming: "all" }),
    JSON.stringify({ page: 2.5, query: "", metric: null, filterTiming: "all" }),
    JSON.stringify({ page: "4", query: "", metric: null, filterTiming: "all" }),
    JSON.stringify({ page: 4, metric: null, filterTiming: "all" }),
    JSON.stringify({ page: 4, query: "", metric: 3, filterTiming: "all" }),
  ]) {
    assert.equal(parseLeadsTableReturn(raw), null, String(raw));
  }
});
