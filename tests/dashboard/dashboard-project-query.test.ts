import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";

import {
  DASHBOARD_PROJECT_PAGE_SIZE,
  dashboardProjectsUrl,
} from "@/components/dashboard/dashboard-project-query";
import { projectListQuerySchema } from "@/utils/validators";
import { REPO_ROOT } from "../support/repo-root";

function paramsOf(url: string) {
  return Object.fromEntries(new URL(url, "http://x").searchParams);
}

describe("dashboardProjectsUrl", () => {
  test("asks for ACTIVE projects only, at the dashboard's page size", () => {
    assert.equal(
      dashboardProjectsUrl({ page: 1, search: "" }),
      "/api/projects?status=ACTIVE&page=1&limit=10",
    );
    assert.equal(DASHBOARD_PROJECT_PAGE_SIZE, 10);
  });

  test("a blank or whitespace search is not sent", () => {
    assert.equal(
      dashboardProjectsUrl({ page: 2, search: "   " }),
      "/api/projects?status=ACTIVE&page=2&limit=10",
    );
  });

  test("the search is trimmed and encoded", () => {
    const url = dashboardProjectsUrl({
      page: 1,
      search: "  Smith & Sons  ",
    });
    assert.deepEqual(paramsOf(url), {
      status: "ACTIVE",
      page: "1",
      limit: "10",
      search: "Smith & Sons",
    });
  });

  test("the request is one the list route accepts with the same filter", () => {
    const parsed = projectListQuerySchema.safeParse(
      paramsOf(dashboardProjectsUrl({ page: 3, search: "kitchen" })),
    );
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.status, "ACTIVE");
    assert.equal(parsed.data.page, 3);
    assert.equal(parsed.data.limit, 10);
    assert.equal(parsed.data.search, "kitchen");
  });
});

describe("dashboard-home", () => {
  test("pagination and search are no longer console.log stubs", () => {
    const source = readFileSync(
      join(REPO_ROOT, "components/dashboard/dashboard-home.tsx"),
      "utf8",
    );
    assert.doesNotMatch(source, /console\.log/);
    assert.doesNotMatch(source, /onSearch|onPageChange/);
  });
});
