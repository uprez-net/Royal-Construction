import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// The admin dashboard's "Site Manager Performance" table was drawn from
// `siteManagersMock`. It now reads the same per-manager figures as the site
// manager's dashboard, and a failed read shows the same warning banner rather
// than an empty table that looks like "no site managers".

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

test("the admin dashboard no longer draws the sample site managers", () => {
  const home = read("components/dashboard/dashboard-home.tsx");
  assert.ok(!/lib\/mock-data/.test(home));
  assert.ok(!/siteManagersMock/.test(read("lib/mock-data.tsx")));
});

test("the admin dashboard reads site manager performance through the settled sections", () => {
  const page = read("app/(main)/dashboard/page.tsx");
  assert.match(
    page,
    /settleDashboardSection\(\s*"site manager performance",\s*getSiteManagerPerformance\(\),/,
  );
  assert.match(page, /siteResult\.warning,/);
  assert.match(page, /siteManagers=\{siteResult\.data\}/);
});
