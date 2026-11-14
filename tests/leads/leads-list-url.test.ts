import assert from "node:assert/strict";
import { test } from "vitest";

import {
  leadDetailHref,
  leadsListHref,
  readLeadsListParams,
  searchHeading,
  searchQueryToRequest,
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
    {
      page: 4,
      query: "sandhu",
      status: "lost",
      timing: "this_week",
      sort: "createdAt-desc",
    },
  );
  assert.deepEqual(readLeadsListParams(params("")), {
    page: 1,
    query: "",
    status: null,
    timing: "all",
    sort: "createdAt-desc",
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

test("sorting resets the page, composes with filters and survives a lead detail visit", () => {
  const query = withLeadsListParams(
    params("page=4&status=lost&timing=this_week&query=smith"),
    {
      page: null,
      sort: "name-desc",
    },
  );
  const list = readLeadsListParams(params(query));
  assert.deepEqual(list, {
    page: 1,
    status: "lost",
    timing: "this_week",
    query: "smith",
    sort: "name-desc",
  });
  const detail = new URL(leadDetailHref(44, query), "http://x");
  const back = new URL(
    leadsListHref(detail.searchParams.get("list")),
    "http://x",
  );
  assert.deepEqual(readLeadsListParams(back.searchParams), list);
  assert.equal(
    readLeadsListParams(params("sort=invalid")).sort,
    "createdAt-desc",
  );
});

// Issue #465: typing "tes" and clearing the box before the URL had caught up
// left ?query=tes applied under an empty box. The box compared what was typed
// with the URL as shown (still empty, the replace had not landed), found
// nothing to do, and never asked for the clear.
test("a clear typed while a search is still in flight is asked for, not skipped (#465)", () => {
  // The URL still shows "" because the replace for "tes" has not landed.
  const shown = "";
  const requested = "tes";
  // What the box did before: judge the clear against the shown query. "" equals
  // "", so it found nothing to do and ?query=tes landed under an empty box.
  assert.equal(searchQueryToRequest("", shown), null);
  // Now: judge it against where the URL is heading, so the clear is requested.
  const heading = searchHeading({
    navigating: true,
    requestedNavigation: 1,
    latestNavigation: 1,
    requested,
    shown,
  });
  assert.equal(heading, "tes");
  assert.equal(searchQueryToRequest("", heading), "");
});

test("the heading is the shown query unless the search request is still the latest navigation in flight", () => {
  const inFlight = {
    navigating: true,
    requestedNavigation: 3,
    latestNavigation: 3,
    requested: "tes",
    shown: "",
  };
  // in flight and still the latest: what the request asked for, a clear included
  assert.equal(searchHeading(inFlight), "tes");
  assert.equal(searchHeading({ ...inFlight, requested: "", shown: "tes" }), "");
  // nothing in flight: the URL is the truth, whatever was requested before
  assert.equal(searchHeading({ ...inFlight, navigating: false }), "");
  // nothing requested yet, even if a transition is pending for another reason
  assert.equal(
    searchHeading({
      ...inFlight,
      requested: null,
      requestedNavigation: -1,
      shown: "abc",
    }),
    "abc",
  );
});

// Found in review of the #465 fix: type "tes" (request in flight), click a
// status card before it lands, then clear the box. The card's navigation
// preempts the search, so judging the clear against "tes" would send a replace
// built from stale params that wipes the card's filter. Staging (old rule) kept
// the status, so the fix must too.
test("a navigation made after the search request makes the shown query the heading again", () => {
  const heading = searchHeading({
    navigating: true,
    requestedNavigation: 1, // the search request
    latestNavigation: 2, // the status card, made after it
    requested: "tes",
    shown: "",
  });
  assert.equal(heading, "");
  // so clearing the box asks for nothing and the card's filter survives
  assert.equal(searchQueryToRequest("", heading), null);
});

test("the search box applies from three characters and keeps a query already in the URL", () => {
  assert.equal(searchQueryToRequest("tes", ""), "tes");
  // already there, or already on its way
  assert.equal(searchQueryToRequest("tes", "tes"), null);
  // a short query that was never applied changes nothing
  assert.equal(searchQueryToRequest("te", ""), null);
  // cutting an applied query back below the threshold removes it
  assert.equal(searchQueryToRequest("s", "smithx"), "");
  assert.equal(searchQueryToRequest("te", "tes"), "");
  // a short query that came in through the URL is kept as it is
  assert.equal(searchQueryToRequest("ab", "ab"), null);
  // changing one applied query for another
  assert.equal(searchQueryToRequest("tez", "tes"), "tez");
});
