import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// getLeads rethrows a failed query since #250, and the stats drilldown chained
// fetchLeads with .then().finally() and no catch: a failure became an unhandled
// rejection and the modal said "No leads found." as though the stage were
// empty. The modal is a client component that loads React, so no test can
// import it; this reads the source instead.

const modal = readFileSync(
  join(
    process.cwd(),
    "components/leads/modal-ui/lead-stats-drilldown-modal.tsx",
  ),
  "utf8",
);

test("a failed load is caught and kept as an error", () => {
  const chain = modal.slice(
    modal.indexOf("fetchLeads("),
    modal.indexOf(".finally("),
  );
  assert.match(chain, /\.catch\(\(err: unknown\) => \{/);
  assert.match(chain, /if \(!cancelled\) \{[\s\S]*setError\(/);
});

test("the error is announced instead of the empty-list message", () => {
  assert.match(modal, /\) : error \? \(\s*<div\s+role="alert"/);
  assert.ok(
    // lastIndexOf: the catch's comment quotes the message too.
    modal.indexOf('role="alert"') < modal.lastIndexOf("No leads found."),
    "the empty-list branch must sit behind the error branch",
  );
});

test("reopening with different filters clears the last error", () => {
  assert.match(modal, /setLoading\(true\);\s*setError\(null\);/);
});
