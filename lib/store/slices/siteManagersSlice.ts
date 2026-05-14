import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export interface SiteManagerLookupItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
}

export interface SiteManagersState {
  items: SiteManagerLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

type SiteManagerLookupResponse = {
  items: SiteManagerLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const initialState: SiteManagersState = {
  items: [],
  page: 0,
  limit: 10,
  totalCount: 0,
  totalPages: 0,
  loading: false,
  loadingMore: false,
  error: null,
};

export const fetchSiteManagers = createAsyncThunk<
  SiteManagerLookupResponse,
  { page?: number; limit?: number; query?: string }
>("siteManagers/fetch", async ({ page = 1, limit = 10, query = "" }) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (query.trim()) {
    params.set("q", query.trim());
  }

  const response = await fetch(`/api/site-managers?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load site managers");
  }

  return (await response.json()) as SiteManagerLookupResponse;
});

const siteManagersSlice = createSlice({
  name: "siteManagers",
  initialState,
  reducers: {
    clearSiteManagers(state) {
      state.items = [];
      state.page = 0;
      state.totalCount = 0;
      state.totalPages = 0;
      state.error = null;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(fetchSiteManagers.pending, (state, action) => {
        if ((action.meta.arg.page ?? 1) > 1 && state.items.length > 0) {
          state.loadingMore = true;
        } else {
          state.loading = true;
          state.items = [];
        }
        state.error = null;
      })
      .addCase(fetchSiteManagers.fulfilled, (state, action) => {
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
      .addCase(fetchSiteManagers.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.error = action.error.message ?? "Failed to load site managers";
      });
  },
});

export const { clearSiteManagers } = siteManagersSlice.actions;
export default siteManagersSlice.reducer;