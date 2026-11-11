import type { PaginatedOfferGroupResult } from "@/types/offer";
import {
  filtersForRequest,
  type OfferListFilters,
} from "@/lib/offer/offer-listing-view";

/** Requested controls and the last successfully displayed rows travel separately. */
export interface OfferListRequestState {
  offers: PaginatedOfferGroupResult;
  filters: OfferListFilters;
  appliedFilters: OfferListFilters;
  requestedPage: number;
  latestRequestId: string | null;
  loading: boolean;
  hydrated: boolean;
  error: string | null;
}

/** Record the complete requested view before a server refresh can inspect it. */
export function beginOfferListRequest(
  state: OfferListRequestState,
  requestId: string,
  request: Partial<OfferListFilters> & { page?: number },
) {
  state.latestRequestId = requestId;
  state.filters = filtersForRequest(state.filters, request);
  state.requestedPage = request.page ?? 1;
  state.loading = true;
  state.error = null;
}

/** Adopt only the newest response and remember which controls produced its rows. */
export function completeOfferListRequest(
  state: OfferListRequestState,
  requestId: string,
  result: PaginatedOfferGroupResult,
) {
  if (requestId !== state.latestRequestId) return;
  state.loading = false;
  state.offers = result;
  state.appliedFilters = state.filters;
  state.requestedPage = result.page;
  state.hydrated = true;
}

/** Keep retained rows and their controls consistent when the newest request fails. */
export function rejectOfferListRequest(
  state: OfferListRequestState,
  requestId: string,
  error: string,
) {
  if (requestId !== state.latestRequestId) return;
  state.loading = false;
  state.filters = state.appliedFilters;
  state.requestedPage = state.offers.page;
  state.error = error;
}
