import { getOfferGroups, updateOfferStatus } from "@/lib/data/offers";
import { PaginatedOfferGroupResult } from "@/types/offer";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { OfferStatus } from "@prisma/client";

interface OffersState {
    offers: PaginatedOfferGroupResult;
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
    loading: false,
    error: null,
};

export const fetchOffers = createAsyncThunk(
    "offers/fetchOffers",
    async (params: { page?: number; limit?: number; q?: string }, thunkAPI) => {
        try {
            const res = await getOfferGroups(params.page, params.limit, params.q);

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
