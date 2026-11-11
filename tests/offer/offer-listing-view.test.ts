import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  filtersForRequest,
  isDefaultOfferFilters,
  shouldAdoptServerOffers,
} from "@/lib/offer/offer-listing-view";

// The offers table fell back to the server's unfiltered first page whenever
// the store held no rows, so a search or tab with no matches showed every
// offer. A remount also overwrote a filtered view with that unfiltered page.
// The table now distinguishes "no rows for this filter" from "not loaded yet",
// and isDefaultOfferFilters decides when the server's page is the right view.

test("the All tab with no search is the default view", () => {
  assert.equal(isDefaultOfferFilters("all", ""), true);
});

test("a whitespace-only search is still the default view", () => {
  assert.equal(isDefaultOfferFilters("all", "   "), true);
});

test("a status tab is a filtered view", () => {
  assert.equal(isDefaultOfferFilters("pending", ""), false);
});

test("a search term is a filtered view", () => {
  assert.equal(isDefaultOfferFilters("all", "smith"), false);
});

// ─── Server refreshes and reassignment (CodeRabbit on #246) ─────────────────

test("a fetch records the tab and search it asks for", () => {
  assert.deepEqual(
    filtersForRequest(
      { status: "all", q: "", sort: "updatedAt-desc" },
      { status: "sent", q: "smith" },
    ),
    { status: "sent", q: "smith", sort: "updatedAt-desc" },
  );
});

test("a page change keeps the current tab and search", () => {
  assert.deepEqual(
    filtersForRequest({ status: "sent", q: "smith", sort: "name-desc" }, {
      page: 2,
    } as {
      status?: undefined;
      q?: undefined;
    }),
    { status: "sent", q: "smith", sort: "name-desc" },
  );
});

test("clearing the search is recorded, not ignored", () => {
  assert.deepEqual(
    filtersForRequest(
      { status: "all", q: "smith", sort: "name-asc" },
      { q: "" },
    ),
    {
      status: "all",
      q: "",
      sort: "name-asc",
    },
  );
});

test("the server's page is adopted only for the unfiltered list on that page", () => {
  const server = { page: 1, limit: 10 };
  const unfiltered = {
    status: "all" as const,
    q: "",
    sort: "updatedAt-desc" as const,
  };
  assert.equal(
    shouldAdoptServerOffers(unfiltered, { page: 1, limit: 10 }, server),
    true,
  );
  assert.equal(
    shouldAdoptServerOffers(unfiltered, { page: 3, limit: 10 }, server),
    false,
    "a refresh would bounce page 3 back to page 1",
  );
  assert.equal(
    shouldAdoptServerOffers(unfiltered, { page: 1, limit: 25 }, server),
    false,
  );
  assert.equal(
    shouldAdoptServerOffers(
      { status: "sent", q: "", sort: "updatedAt-desc" },
      { page: 1, limit: 10 },
      server,
    ),
    false,
  );
});

test("a server refresh preserves a non-default sort even on the first page", () => {
  const page = { page: 1, limit: 10 };
  assert.equal(
    shouldAdoptServerOffers(
      { status: "all", q: "", sort: "name-desc" },
      page,
      page,
    ),
    false,
  );
  assert.deepEqual(
    filtersForRequest(
      { status: "sent", q: "smith", sort: "name-desc" },
      { sort: "createdAt-asc" },
    ),
    { status: "sent", q: "smith", sort: "createdAt-asc" },
  );
});

test("the store and updateLead use these rules", () => {
  const slice = readFileSync("lib/store/slices/offerSlice.ts", "utf8");
  assert.match(
    slice,
    /fetchOffers\.pending[\s\S]{0,500}beginOfferListRequest\(/,
    "pending does not record the filters",
  );
  assert.match(
    slice,
    /shouldAdoptServerOffers\(filters, requestedPaging, serverOffers\)/,
    "syncServerOffers ignores the page",
  );
  assert.match(
    slice,
    /const requestedPaging = \{ page: requestedPage, limit: offers.limit \}/,
  );
  assert.match(slice, /fetchOffers\(\{\s*page: requestedPage,/);
  const leads = readFileSync("lib/data/leads.ts", "utf8");
  // The assignee trigger must stay unconditional on being SET — a compare
  // against the lead read before the transaction could skip an expiry it owed.
  // It is OR'd with the listed-field trigger (name, contact, location, type),
  // which this branch adds, so the pattern allows that second condition without
  // allowing the assignee side to regain a comparison. The listed-field flag is
  // now a property on the domain command's result, hence the dotted name.
  assert.match(
    leads,
    /if \(input\.assignedId !== undefined(?: \|\| [\w.]+)?\) \{[\s\S]{0,200}revalidateTag\("offers"/,
    "updateLead does not expire the offers list on reassignment",
  );
});
