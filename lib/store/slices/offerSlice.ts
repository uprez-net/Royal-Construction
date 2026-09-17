import { getOfferGroups, updateOfferStatus } from "@/lib/data/offers";
import { PaginatedOfferGroupResult, OfferStatusBucket } from "@/types/offer";
import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { OfferStatus } from "@prisma/client";
import {
  filtersForRequest,
  shouldAdoptServerOffers,
} from "@/lib/offer/offer-listing-view";

interface OffersState {
  offers: PaginatedOfferGroupResult;
  /**
   * The last filter the user applied (tab bucket + search string). Kept in
   * the store — not in a component — so `handlePageChange` in the table can
   * re-dispatch a fetch that *preserves* them instead of dropping them.
   */
  filters: {
    status: OfferStatusBucket;
    q: string;
  };
  loading: boolean;
  error: string | null;
  /**
   * The requestId of the newest fetchOffers. Searches go out as the user
   * types and can resolve out of order on a slow link, so only the newest
   * request may write rows and filters. Otherwise the table can end on the
   * results for a query the search box no longer shows.
   */
  latestRequestId: string | null;
  /**
   * Whether `offers` holds a real result yet. Before it does, the table shows
   * the server's page. After, an empty `items` means "nothing matches", not
   * "not loaded".
   */
  hydrated: boolean;
}

const initialState: OffersState = {
  offers: {
    items: [],
    page: 1,
    limit: 10,
    totalCount: 0,
    totalOfferCount: 0,
    totalPages: 1,
  },
  filters: {
    status: "all",
    q: "",
  },
  loading: false,
  error: null,
  latestRequestId: null,
  hydrated: false,
};

export const fetchOffers = createAsyncThunk(
  "offers/fetchOffers",
  async (
    params: {
      page?: number;
      limit?: number;
      q?: string;
      status?: OfferStatusBucket;
    },
    thunkAPI,
  ) => {
    try {
      const res = await getOfferGroups(
        params.page,
        params.limit,
        params.q,
        params.status,
      );

      return res;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch offers",
      );
    }
  },
);

export const updateOffer = createAsyncThunk(
  "offers/updateOfferStatus",
  async (
    { offerId, status }: { offerId: string; status: OfferStatus },
    thunkAPI,
  ) => {
    try {
      // Call server action to update offer status
      const updatedOffer = await updateOfferStatus(offerId, status);
      return updatedOffer;
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to update offer status",
      );
    }
  },
);

const offersSlice = createSlice({
  name: "offers",
  initialState,
  reducers: {
    setOffers(state, action: PayloadAction<PaginatedOfferGroupResult>) {
      state.offers = action.payload;
      // The server renders the unfiltered first page, so adopting its
      // rows adopts its filters too. Keeping a stale tab here left the
      // tab and the rows describing different views.
      state.filters = { status: "all", q: "" };
      state.hydrated = true;
      // Any fetch still in flight was for the view this replaces.
      state.latestRequestId = null;
      state.loading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOffers.pending, (state, action) => {
        state.latestRequestId = action.meta.requestId;
        // Record what the user asked for now, not when it resolves. A
        // server refresh that lands while this is loading reads these
        // filters, and must not re-fetch or adopt the view they left.
        state.filters = filtersForRequest(state.filters, action.meta.arg);
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOffers.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.latestRequestId) return;
        state.loading = false;
        state.offers = action.payload;
        state.hydrated = true;
        // Persist the filters that produced this result so a later page
        // change (dispatched from the table) re-applies them. Undefined
        // means "leave the existing filter untouched", which lets the
        // table re-fetch a page without redeclaring the active tab/q.
        state.filters = filtersForRequest(state.filters, action.meta.arg);
      })
      .addCase(fetchOffers.rejected, (state, action) => {
        if (action.meta.requestId !== state.latestRequestId) return;
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(updateOffer.pending, (state) => {
        state.error = null;
      })
      .addCase(updateOffer.fulfilled, (state, action) => {
        const updatedOffer = action.payload;

        // The status can be changed from the collapsed row (which acts on
        // the representative revision) or from any row of the expanded
        // version history, so the revision has to be located inside its
        // group rather than by a top-level index. `latest` is the same
        // object identity as its entry in `revisions` only before Immer
        // drafts them, so both are patched explicitly.
        for (const group of state.offers.items) {
          if (group.leadId !== updatedOffer.leadId) continue;

          const revision = group.revisions.find(
            (item) => item.id === updatedOffer.id,
          );
          if (revision) revision.offerStatus = updatedOffer.offerStatus;

          if (group.latest.id === updatedOffer.id) {
            group.latest.offerStatus = updatedOffer.offerStatus;
          }

          break;
        }
      })
      .addCase(updateOffer.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const { setOffers } = offersSlice.actions;

/**
 * Reconcile the store with the page the server just rendered, on mount and on
 * every router.refresh(). The server always renders the unfiltered first page:
 * adopt it when that is the view the user has, and otherwise refetch the
 * user's own tab, search and page so a refresh or a Back navigation keeps them.
 */
export const syncServerOffers = createAsyncThunk<
  void,
  PaginatedOfferGroupResult,
  { state: { offers: OffersState } }
>("offers/syncServerOffers", async (serverOffers, { dispatch, getState }) => {
  const { filters, offers } = getState().offers;
  if (shouldAdoptServerOffers(filters, offers, serverOffers)) {
    dispatch(setOffers(serverOffers));
    return;
  }
  await dispatch(
    fetchOffers({
      page: offers.page,
      limit: offers.limit,
      status: filters.status,
      q: filters.q,
    }),
  );
});

export default offersSlice.reducer;
