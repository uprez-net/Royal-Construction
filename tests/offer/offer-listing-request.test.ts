import assert from "node:assert/strict";
import { test } from "vitest";
import {
  beginOfferListRequest,
  completeOfferListRequest,
  rejectOfferListRequest,
  type OfferListRequestState,
} from "@/lib/store/slices/offer-listing-request";
import { shouldAdoptServerOffers } from "@/lib/offer/offer-listing-view";

/** Build a successfully displayed page before the next interaction starts. */
function displayedPage(): OfferListRequestState {
  const filters = {
    status: "sent" as const,
    q: "smith",
    sort: "updatedAt-desc" as const,
  };
  return {
    offers: {
      items: [],
      page: 5,
      limit: 10,
      totalCount: 60,
      totalOfferCount: 90,
      totalPages: 6,
    },
    filters,
    appliedFilters: filters,
    requestedPage: 5,
    latestRequestId: null,
    loading: false,
    hydrated: true,
    error: null,
  };
}

test("a server refresh during sorting retains requested page 1 rather than displayed page 5", () => {
  const state = displayedPage();
  beginOfferListRequest(state, "sort", { page: 1, sort: "name-desc" });
  assert.equal(state.offers.page, 5, "retained rows still belong to page 5");
  const requestedPaging = {
    page: state.requestedPage,
    limit: state.offers.limit,
  };
  assert.equal(requestedPaging.page, 1);
  assert.equal(
    shouldAdoptServerOffers(state.filters, requestedPaging, {
      page: 1,
      limit: 10,
    }),
    false,
  );
  beginOfferListRequest(state, "refresh", {
    ...state.filters,
    page: requestedPaging.page,
  });
  completeOfferListRequest(state, "sort", { ...state.offers, page: 1 });
  assert.equal(
    state.loading,
    true,
    "superseded responses must not finish the refresh",
  );
  completeOfferListRequest(state, "refresh", { ...state.offers, page: 1 });
  assert.equal(state.offers.page, 1);
  assert.equal(state.appliedFilters.sort, "name-desc");
});

test("a failed sort restores the controls and page matching the retained rows", () => {
  const state = displayedPage();
  const rows = state.offers;
  const applied = { ...state.appliedFilters };
  beginOfferListRequest(state, "sort", { page: 1, sort: "name-desc" });
  beginOfferListRequest(state, "refresh", { page: 1, ...state.filters });
  rejectOfferListRequest(state, "refresh", "Failed to fetch offers");
  assert.equal(state.offers, rows);
  assert.deepEqual(state.filters, applied);
  assert.equal(state.requestedPage, 5);
  assert.equal(state.loading, false);
  assert.equal(state.error, "Failed to fetch offers");
});

test("a stale failure cannot roll back a newer requested or completed sort", () => {
  const state = displayedPage();
  beginOfferListRequest(state, "older", { page: 1, sort: "name-desc" });
  beginOfferListRequest(state, "newer", { page: 1, sort: "createdAt-asc" });
  rejectOfferListRequest(state, "older", "Old error");
  assert.equal(state.filters.sort, "createdAt-asc");
  assert.equal(state.loading, true);
  assert.equal(state.error, null);
  completeOfferListRequest(state, "newer", { ...state.offers, page: 1 });
  rejectOfferListRequest(state, "older", "Old error");
  assert.equal(state.filters.sort, "createdAt-asc");
  assert.equal(state.appliedFilters.sort, "createdAt-asc");
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
});
