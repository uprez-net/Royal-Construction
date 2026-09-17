import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import {
  filtersForRequest,
  isDefaultOfferFilters,
  shouldAdoptServerOffers,
} from "../../lib/offer/offer-listing-view";

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
    filtersForRequest({ status: "all", q: "" }, { status: "sent", q: "smith" }),
    { status: "sent", q: "smith" },
  );
});

test("a page change keeps the current tab and search", () => {
  assert.deepEqual(
    filtersForRequest({ status: "sent", q: "smith" }, { page: 2 } as {
      status?: undefined;
      q?: undefined;
    }),
    { status: "sent", q: "smith" },
  );
});

test("clearing the search is recorded, not ignored", () => {
  assert.deepEqual(
    filtersForRequest({ status: "all", q: "smith" }, { q: "" }),
    {
      status: "all",
      q: "",
    },
  );
});

test("the server's page is adopted only for the unfiltered list on that page", () => {
  const server = { page: 1, limit: 10 };
  const unfiltered = { status: "all" as const, q: "" };
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
      { status: "sent", q: "" },
      { page: 1, limit: 10 },
      server,
    ),
    false,
  );
});

test("the store and updateLead use these rules", () => {
  const slice = readFileSync("lib/store/slices/offerSlice.ts", "utf8");
  assert.match(
    slice,
    /fetchOffers\.pending[\s\S]{0,500}filtersForRequest\(/,
    "pending does not record the filters",
  );
  assert.match(
    slice,
    /shouldAdoptServerOffers\(filters, offers, serverOffers\)/,
    "syncServerOffers ignores the page",
  );
  const leads = readFileSync("lib/data/leads.ts", "utf8");
  // The assignee trigger must stay unconditional on being SET — a compare
  // against the lead read before the transaction could skip an expiry it owed.
  // It is OR'd with the listed-field trigger (name, contact, location, type),
  // which this branch adds, so the pattern allows that second condition without
  // allowing the assignee side to regain a comparison.
  assert.match(
    leads,
    /if \(input\.assignedId !== undefined(?: \|\| \w+)?\) \{[\s\S]{0,200}revalidateTag\("offers"/,
    "updateLead does not expire the offers list on reassignment",
  );
});
