import { getOffers, updateOfferStatus } from "@/lib/data/offers";
import { PaginatedOfferResult } from "@/types/offer";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { OfferWithLead } from "@/types/offer";
import { OfferStatus } from "@prisma/client";

interface OffersState {
    offers: PaginatedOfferResult;
    loading: boolean;
    error: string | null;
}

const initialState: OffersState = {
    offers: {
        items: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
    },
    loading: false,
    error: null,
};

export const fetchOffers = createAsyncThunk(
    "offers/fetchOffers",
    async (params: { page?: number; limit?: number; q?: string }, thunkAPI) => {
        try {
            const res = await getOffers(params.page, params.limit, params.q);

            return res;
        } catch (error) {
            return thunkAPI.rejectWithValue(error instanceof Error ? error.message : "Failed to fetch offers");
        }
    });

export const updateOffer = createAsyncThunk(
    "offers/updateOfferStatus",
    async ({ offerId, leadId, status }: { offerId: string; leadId: number; status: OfferStatus }, thunkAPI) => {
        try {
            // Call server action to update offer status
            const updatedOffer = await updateOfferStatus(offerId, leadId, status);
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
        setOffers(state, action: PayloadAction<PaginatedOfferResult>) {
            state.offers = action.payload;
        },
        addOffer(state, action: PayloadAction<OfferWithLead>) {
            state.offers.items.unshift(action.payload);
            state.offers.totalCount += 1;
            state.offers.totalPages = Math.max(1, Math.ceil(state.offers.totalCount / state.offers.limit));
        }   
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
                const index = state.offers.items.findIndex((offer) => offer.id === updatedOffer.id);
                if (index !== -1) {
                    state.offers.items[index].offerStatus = updatedOffer.offerStatus;
                }
            })
            .addCase(updateOffer.rejected, (state, action) => {
                state.error = action.payload as string;
            });
    }
});

export const { setOffers, addOffer } = offersSlice.actions;
export default offersSlice.reducer;
