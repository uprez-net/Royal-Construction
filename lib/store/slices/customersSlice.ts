import { fetchJson } from "@/utils/fetch";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export interface CustomerLookupItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}

export interface CustomersState {
  items: CustomerLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

type CustomerLookupResponse = {
  items: CustomerLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const initialState: CustomersState = {
  items: [],
  page: 0,
  limit: 10,
  totalCount: 0,
  totalPages: 0,
  loading: false,
  loadingMore: false,
  error: null,
};

export const fetchCustomers = createAsyncThunk<
  CustomerLookupResponse,
  { page?: number; limit?: number; query?: string }
>("customers/fetch", async ({ page = 1, limit = 10, query = "" }) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (query.trim()) {
    params.set("q", query.trim());
  }

  const response = await fetchJson<CustomerLookupResponse>(
    `/api/customers?${params.toString()}`,
    { method: "GET" },
    "Unable to load customers"
  );

  return response.data;
});

const customersSlice = createSlice({
  name: "customers",
  initialState,
  reducers: {
    clearCustomers(state) {
      state.items = [];
      state.page = 0;
      state.totalCount = 0;
      state.totalPages = 0;
      state.error = null;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(fetchCustomers.pending, (state, action) => {
        if ((action.meta.arg.page ?? 1) > 1 && state.items.length > 0) {
          state.loadingMore = true;
        } else {
          state.loading = true;
          state.items = [];
        }
        state.error = null;
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        const nextItems = action.payload.items;
        const isFirstPage = (action.meta.arg.page ?? 1) === 1;

        state.items = isFirstPage
          ? nextItems
          : [...state.items, ...nextItems.filter((item) => !state.items.some((existing) => existing.id === item.id))];
        state.page = action.payload.page;
        state.limit = action.payload.limit;
        state.totalCount = action.payload.totalCount;
        state.totalPages = action.payload.totalPages;
        state.loading = false;
        state.loadingMore = false;
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.error = action.error.message ?? "Failed to load customers";
      });
  },
});

export const { clearCustomers } = customersSlice.actions;
export default customersSlice.reducer;