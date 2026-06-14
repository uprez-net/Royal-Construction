import { getOffers } from "@/lib/data/offers";
import { PaginatedOfferResult } from "@/types/offer";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { OfferWithLead } from "@/types/offer";

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
    })

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
            });
    }
});

export const { setOffers, addOffer } = offersSlice.actions;
export default offersSlice.reducer;
