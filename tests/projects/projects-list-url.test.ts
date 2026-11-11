import assert from "node:assert/strict";
import { test } from "vitest";

import {
  projectDetailHref,
  projectsListHref,
  projectsListKey,
  projectsListQuery,
  readProjectsListParams,
  withProjectsListParams,
} from "@/components/projects/projects-list-url";

// Opening a project from the Active chip and coming back put the list on All:
// the chip lived in Redux and was cleared as the page was hidden. The list's
// chip, page, search and sort now live in the /projects URL.

const params = (query: string) => new URLSearchParams(query);

test("the list reads its place from the URL", () => {
  assert.deepEqual(
    readProjectsListParams(
      params("status=ACTIVE&page=3&query=%20smith%20&sort=progress"),
    ),
    { status: "ACTIVE", page: 3, query: "smith", sort: "progress" },
  );
  assert.deepEqual(readProjectsListParams(params("")), {
    status: null,
    page: 1,
    query: "",
    sort: "name",
  });
  assert.equal(
    readProjectsListParams(params("status=PRE_CONSTRUCTION")).status,
    "PRE_CONSTRUCTION",
  );
});

test("a nonsense status, page or sort falls back rather than reaching the API", () => {
  for (const page of ["0", "-2", "2.5", "four", "1e400"]) {
    assert.equal(readProjectsListParams(params(`page=${page}`)).page, 1, page);
  }
  for (const status of ["active", "Nonsense", ""]) {
    assert.equal(
      readProjectsListParams(params(`status=${status}`)).status,
      null,
      status,
    );
  }
  assert.equal(readProjectsListParams(params("sort=createdAt")).sort, "name");
});

test("a sort option brings its own direction to the API", () => {
  const list = readProjectsListParams(params("status=COMPLETED&sort=budget"));
  assert.deepEqual(projectsListQuery(list, 12), {
    status: "COMPLETED",
    page: 1,
    limit: 12,
    search: "",
    sortBy: "budget",
    sortOrder: "desc",
  });
  assert.equal(
    projectsListQuery(readProjectsListParams(params("")), 12).sortOrder,
    "asc",
  );
});

test("descending project names survive paging and a detail visit", () => {
  const list = readProjectsListParams(
    params("sort=name-desc&page=2&status=ACTIVE"),
  );
  assert.equal(projectsListQuery(list, 12).sortBy, "name");
  assert.equal(projectsListQuery(list, 12).sortOrder, "desc");
  assert.notEqual(
    projectsListKey(list),
    projectsListKey({ ...list, sort: "name" }),
  );
  const detail = new URL(
    projectDetailHref("p1", "sort=name-desc&page=2&status=ACTIVE"),
    "http://x",
  );
  const back = new URL(
    projectsListHref(detail.searchParams.get("list")),
    "http://x",
  );
  assert.deepEqual(readProjectsListParams(back.searchParams), list);
});

test("the same list has the same key however the URL spells it", () => {
  const key = (query: string) =>
    projectsListKey(readProjectsListParams(params(query)));
  assert.equal(
    key("sort=progress&status=ACTIVE"),
    key("status=ACTIVE&sort=progress&utm=x"),
  );
  assert.equal(key(""), key("page=1&sort=name&status=bogus"));
  assert.notEqual(key("status=ACTIVE"), key("status=COMPLETED"));
  assert.notEqual(key("status=ACTIVE"), key("status=ACTIVE&page=2"));
});

test("a change sets or removes parameters and keeps the rest", () => {
  const current = params("status=ACTIVE&page=4&utm=x");
  assert.equal(
    withProjectsListParams(current, { page: "5" }),
    "?status=ACTIVE&page=5&utm=x",
  );
  assert.equal(
    withProjectsListParams(current, { status: null, page: null }),
    "?utm=x",
  );
  assert.equal(withProjectsListParams(params("page=2"), { page: null }), "");
});

test("a project remembers the list it was opened from, and only that", () => {
  const href = projectDetailHref("p1", "status=ACTIVE&page=2&utm=x");
  assert.equal(href, "/projects/p1?list=status%3DACTIVE%26page%3D2");
  const list = new URL(href, "http://x").searchParams.get("list");
  assert.equal(projectsListHref(list), "/projects?status=ACTIVE&page=2");
  assert.equal(projectDetailHref("p1", ""), "/projects/p1");
});

test("Back to all projects can only ever point at the Projects list", () => {
  assert.equal(projectsListHref(null), "/projects");
  assert.equal(projectsListHref(""), "/projects");
  assert.equal(projectsListHref("next=//evil.example"), "/projects");
  assert.equal(
    projectsListHref("status=ACTIVE&redirect=https://evil.example"),
    "/projects?status=ACTIVE",
  );
});
