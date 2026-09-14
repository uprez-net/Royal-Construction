import { test } from "node:test";
import assert from "node:assert/strict";

import { isDefaultOfferFilters } from "../../lib/offer/offer-listing-view";

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
