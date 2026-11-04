import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// The Financials tab shipped calling `useQuery` with no QueryClientProvider
// above it: the app shell's provider wraps only the notifications bell, not
// the page. Every project page then failed with "No QueryClient set" and
// showed "This project could not be loaded". The tab now brings its own
// client.
//
// Read as source rather than rendered: the tab imports its Server Actions,
// which reach `server-only` (tests/architecture/test-suite-loadable.test.ts).

const source = readFileSync(
  join(
    REPO_ROOT,
    "components/projects/detail/financials-tab/project-financials-tab.tsx",
  ),
  "utf8",
);

/** The body of the exported tab, up to the next top-level function. */
function exportedTab(): string {
  const start = source.indexOf("export function ProjectFinancialsTab(");
  assert.notEqual(start, -1, "ProjectFinancialsTab is no longer exported");
  const end = source.indexOf("\nfunction ", start);
  return source.slice(start, end === -1 ? undefined : end);
}

test("the exported Financials tab provides its own QueryClient", () => {
  const tab = exportedTab();
  assert.match(tab, /new QueryClient\(\)/);
  assert.match(tab, /<QueryClientProvider client=\{queryClient\}>/);
  // The queries live in the component it wraps, not in the wrapper itself.
  assert.doesNotMatch(tab, /useQuery\(/);
});
