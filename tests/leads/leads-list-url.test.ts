import assert from "node:assert/strict";
import { test } from "vitest";

import {
  leadDetailHref,
  leadsListHref,
  readLeadsListParams,
  withLeadsListParams,
} from "@/components/leads/leads-list-url";

// Issue #350: coming back from a lead put the Leads table on page 1. The
// table's page and filters now live in the /leads URL.

const params = (query: string) => new URLSearchParams(query);

test("the table reads its place from the URL", () => {
  assert.deepEqual(
    readLeadsListParams(
      params("page=4&query=sandhu&status=lost&timing=this_week"),
    ),
    { page: 4, query: "sandhu", status: "lost", timing: "this_week" },
  );
  assert.deepEqual(readLeadsListParams(params("")), {
    page: 1,
    query: "",
    status: null,
    timing: "all",
  });
});

test("a nonsense page, status or timing falls back rather than reaching the API", () => {
  for (const page of ["0", "-2", "2.5", "four", "1e400"]) {
    assert.equal(readLeadsListParams(params(`page=${page}`)).page, 1, page);
  }
  assert.equal(readLeadsListParams(params("status=Nonsense")).status, null);
  assert.equal(
    readLeadsListParams(params("status=Archived,Converted")).status,
    "Archived,Converted",
  );
  for (const timing of ["", "30d", "Today", "all"]) {
    assert.equal(readLeadsListParams(params(`timing=${timing}`)).timing, "all");
  }
});

test("a change sets or removes parameters and keeps the rest", () => {
  const current = params("page=4&status=lost&utm=x");
  assert.equal(
    withLeadsListParams(current, { page: "5" }),
    "?page=5&status=lost&utm=x",
  );
  assert.equal(
    withLeadsListParams(current, { status: null, page: null }),
    "?utm=x",
  );
  assert.equal(withLeadsListParams(params("page=2"), { page: null }), "");
});

test("a lead remembers the list it was opened from, and only that", () => {
  const href = leadDetailHref(44, "page=4&status=lost&utm=x");
  assert.equal(href, "/leads/44?list=page%3D4%26status%3Dlost");
  const list = new URL(href, "http://x").searchParams.get("list");
  assert.equal(leadsListHref(list), "/leads?page=4&status=lost");
  assert.equal(leadDetailHref(44, ""), "/leads/44");
});

test("Back to all leads can only ever point at the Leads table", () => {
  assert.equal(leadsListHref(null), "/leads");
  assert.equal(leadsListHref(""), "/leads");
  assert.equal(leadsListHref("next=//evil.example"), "/leads");
  assert.equal(
    leadsListHref("page=2&redirect=https://evil.example"),
    "/leads?page=2",
  );
});
