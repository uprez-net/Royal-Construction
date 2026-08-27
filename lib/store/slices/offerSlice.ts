import { getOfferGroups, updateOfferStatus } from "@/lib/data/offers";
import { PaginatedOfferGroupResult, OfferStatusBucket } from "@/types/offer";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { OfferStatus } from "@prisma/client";

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
};

export const fetchOffers = createAsyncThunk(
    "offers/fetchOffers",
    async (params: { page?: number; limit?: number; q?: string; status?: OfferStatusBucket }, thunkAPI) => {
        try {
            const res = await getOfferGroups(params.page, params.limit, params.q, params.status);

            return res;
        } catch (error) {
            return thunkAPI.rejectWithValue(error instanceof Error ? error.message : "Failed to fetch offers");
        }
    });

export const updateOffer = createAsyncThunk(
    "offers/updateOfferStatus",
    async ({ offerId, status }: { offerId: string; status: OfferStatus }, thunkAPI) => {
        try {
            // Call server action to update offer status
            const updatedOffer = await updateOfferStatus(offerId, status);
            return updatedOffer;
        }
        catch (error) {
            return thunkAPI.rejectWithValue(error instanceof Error ? error.message : "Failed to update offer status");
        }
    });

const offersSlice = createSlice({
    name: "offers",
    initialState,
    reducers: {
        setOffers(state, action: PayloadAction<PaginatedOfferGroupResult>) {
            state.offers = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchOffers.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchOffers.fulfilled, (state, action) => {
                state.loading = false;
                state.offers = action.payload;
                // Persist the filters that produced this result so a later page
                // change (dispatched from the table) re-applies them. Undefined
                // means "leave the existing filter untouched", which lets the
                // table re-fetch a page without redeclaring the active tab/q.
                if (action.meta.arg.status !== undefined) {
                    state.filters.status = action.meta.arg.status;
                }
                if (action.meta.arg.q !== undefined) {
                    state.filters.q = action.meta.arg.q;
                }
            })
            .addCase(fetchOffers.rejected, (state, action) => {
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

                    const revision = group.revisions.find((item) => item.id === updatedOffer.id);
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
    }
});

export const { setOffers } = offersSlice.actions;
export default offersSlice.reducer;
