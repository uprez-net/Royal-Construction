import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { PaginatedQuotesResult } from "@/types/quote";
import { getQuotes } from "@/lib/data/quotes";

interface QuotesState {
    quotes: PaginatedQuotesResult
    loading: boolean;
    error: string | null;
}

const initialState: QuotesState = {
    quotes: {
        items: [],
        page: 1,
        limit: 10,
        totalCount: 0,
        totalPages: 1,
    },
    loading: false,
    error: null,
};

export const fetchQuotes = createAsyncThunk(
    "quotes/fetchQuotes",
    async (params: { page?: number; limit?: number; q?: string }, thunkAPI) => {
        try {
            const res = await getQuotes(params.page, params.limit, params.q);

            return res;
        } catch (error) {
            return thunkAPI.rejectWithValue(error instanceof Error ? error.message : "Failed to fetch quotes");
        }
    })

const quotesSlice = createSlice({
    name: "quotes",
    initialState,
    reducers: {
        setQuotes(state, action: PayloadAction<PaginatedQuotesResult>) {
            state.quotes = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchQuotes.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchQuotes.fulfilled, (state, action) => {
                state.loading = false;
                state.quotes = action.payload;
            })
            .addCase(fetchQuotes.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });
    }
});

export const { setQuotes } = quotesSlice.actions;
export default quotesSlice.reducer;