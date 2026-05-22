import { TradieScheduleStatus } from "@prisma/client";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "@/lib/store";
import type {
  SafeTradie,
  TradieCoordinationDashboard,
  TradieCoordinationSortBy,
  TradieCoordinationTab,
  TradieProjectAllocationItem,
  TradieScheduleListItem,
  TradieStatusMetric,
  TradieTradeBreakdownItem,
  TradieUtilizationTrendPoint,
  TradieActivityItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { fetchJson } from "@/utils/fetch";
import { ProjectLookupItem } from "@/lib/data/projects";

type CreateScheduleRequest = {
  tradieId: string;
  projectId: string;
  milestoneId?: string;
  scheduledDate: string;
  durationDays?: number;
};

type UpdateScheduleStatusRequest = {
  scheduleId: string;
  status: TradieScheduleStatus;
  notes?: string;
};

type UpdateScheduleStatusResponse = {
  schedule: TradieScheduleListItem;
  requiresReplacement: boolean;
};

type ProjectLookupResponse = {
  items: ProjectLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const defaultTabCounts = {
  all: 0,
  week: 0,
  confirmed: 0,
  pending: 0,
  overdue: 0,
  completed: 0,
};

function getQueryKey(state: TradiesState) {
  return [
    state.pagination.page,
    state.pagination.limit,
    state.filters.search,
    state.filters.projectId ?? "",
    state.filters.tradeType ?? "",
    state.filters.status ?? "",
    state.filters.tab,
    state.filters.sortBy,
    state.filters.sortOrder,
  ].join("|");
}

export interface TradiesState {
  tradies: SafeTradie[];
  schedules: TradieScheduleListItem[];
  filters: {
    search: string;
    projectId: string | null;
    tradeType: string | null;
    status: TradieScheduleStatus | null;
    tab: TradieCoordinationTab;
    sortBy: TradieCoordinationSortBy;
    sortOrder: "asc" | "desc";
  };
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  summary: TradieCoordinationDashboard["summary"] | null;
  tabCounts: TradieCoordinationDashboard["tabCounts"];
  tradeOptions: string[];
  statusMetrics: TradieStatusMetric[];
  tradeBreakdown: TradieTradeBreakdownItem[];
  projectAllocations: TradieProjectAllocationItem[];
  utilizationTrend: TradieUtilizationTrendPoint[];
  activity: TradieActivityItem[];
  urgentReminders: TradieUrgentReminderItem[];
  selectedScheduleIds: string[];
  loading: boolean;
  error: string | null;
  replacementRequired: string[];
  pendingScheduleIds: string[];
  lastQueryKey: string | null;
  cache: Record<string, { data: TradieCoordinationDashboard; fetchedAt: number }>;
  projectLookup: {
    items: ProjectLookupItem[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  };
}

const initialState: TradiesState = {
  tradies: [],
  schedules: [],
  filters: {
    search: "",
    projectId: null,
    tradeType: null,
    status: null,
    tab: "all",
    sortBy: "scheduledDate",
    sortOrder: "asc",
  },
  pagination: {
    page: 1,
    limit: 10,
    totalCount: 0,
    totalPages: 1,
  },
  summary: null,
  tabCounts: defaultTabCounts,
  tradeOptions: [],
  statusMetrics: [],
  tradeBreakdown: [],
  projectAllocations: [],
  utilizationTrend: [],
  activity: [],
  urgentReminders: [],
  selectedScheduleIds: [],
  loading: false,
  error: null,
  replacementRequired: [],
  pendingScheduleIds: [],
  lastQueryKey: null,
  cache: {},
  projectLookup: {
    items: [],
    page: 0,
    limit: 10,
    totalCount: 0,
    totalPages: 0,
    loading: false,
    loadingMore: false,
    error: null,
  },
};

export const fetchTradieCoordinationDashboard = createAsyncThunk<
  TradieCoordinationDashboard,
  { force?: boolean } | undefined,
  { state: RootState }
>("tradies/fetchCoordinationDashboard", async (args, thunkApi) => {
  const state = thunkApi.getState().tradies;
  const queryKey = getQueryKey(state);
  const force = args?.force ?? false;

  if (!force) {
    const cached = state.cache[queryKey];
    if (cached && Date.now() - cached.fetchedAt < 30_000) {
      return cached.data;
    }
  }

  const params = new URLSearchParams({
    mode: "coordination",
    page: String(state.pagination.page),
    limit: String(state.pagination.limit),
    search: state.filters.search,
    tab: state.filters.tab,
    sortBy: state.filters.sortBy,
    sortOrder: state.filters.sortOrder,
  });

  if (state.filters.projectId) params.set("projectId", state.filters.projectId);
  if (state.filters.tradeType) params.set("tradeType", state.filters.tradeType);
  if (state.filters.status) params.set("status", state.filters.status);

  const response = await fetchJson<TradieCoordinationDashboard>(
    `/api/tradie-schedules?${params.toString()}`,
    { method: "GET" },
    "Failed to load tradie coordination data"
  );

  return response.data;
});

export const fetchTradieProjectLookup = createAsyncThunk<
  ProjectLookupResponse,
  { page?: number; limit?: number; query?: string }
>("tradies/fetchProjectLookup", async ({ page = 1, limit = 10, query = "" }) => {
  const params = new URLSearchParams({
    mode: "lookup",
    page: String(page),
    limit: String(limit),
  });

  if (query.trim()) {
    params.set("q", query.trim());
  }

  const response = await fetchJson<ProjectLookupResponse>(
    `/api/projects?${params.toString()}`,
    {
      method: "GET",
    },
    "Failed to load projects"
  );

  return response.data;
});

export const createTradieSchedule = createAsyncThunk<
  TradieScheduleListItem,
  CreateScheduleRequest
>("tradies/createSchedule", async (payload) => {
  const response = await fetchJson<TradieScheduleListItem>(
    "/api/tradie-schedules",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to create tradie schedule"
  );

  return response.data;
});

export const updateTradieScheduleStatus = createAsyncThunk<
  UpdateScheduleStatusResponse,
  UpdateScheduleStatusRequest
>("tradies/updateScheduleStatus", async (payload) => {
  const { scheduleId, status, notes } = payload;

  const response = await fetchJson<UpdateScheduleStatusResponse>(
    `/api/tradie-schedules/${scheduleId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes }),
    },
    "Failed to update schedule status"
  );

  return response.data;
});

const tradiesSlice = createSlice({
  name: "tradies",
  initialState,
  reducers: {
    hydrateTradieCoordination(state, action: PayloadAction<TradieCoordinationDashboard>) {
      const payload = action.payload;
      state.schedules = payload.schedules;
      state.filters = {
        search: payload.query.search,
        projectId: payload.query.projectId,
        tradeType: payload.query.tradeType,
        status: payload.query.status,
        tab: payload.query.tab,
        sortBy: payload.query.sortBy,
        sortOrder: payload.query.sortOrder,
      };
      state.pagination = {
        page: payload.pagination.page,
        limit: payload.pagination.limit,
        totalCount: payload.pagination.totalCount,
        totalPages: payload.pagination.totalPages,
      };
      state.summary = payload.summary;
      state.tabCounts = payload.tabCounts;
      state.tradeOptions = payload.tradeOptions;
      state.statusMetrics = payload.statusMetrics;
      state.tradeBreakdown = payload.tradeBreakdown;
      state.projectAllocations = payload.projectAllocations;
      state.utilizationTrend = payload.utilizationTrend;
      state.activity = payload.activity;
      state.urgentReminders = payload.urgentReminders;
      const key = getQueryKey(state);
      state.lastQueryKey = key;
      state.cache[key] = { data: payload, fetchedAt: Date.now() };
    },
    setTradies(state, action: PayloadAction<SafeTradie[]>) {
      state.tradies = action.payload;
    },
    setTradieFilters(state, action: PayloadAction<Partial<TradiesState["filters"]>>) {
      state.filters = { ...state.filters, ...action.payload };
      state.pagination.page = 1;
      state.selectedScheduleIds = [];
    },
    setTradiePage(state, action: PayloadAction<number>) {
      state.pagination.page = Math.max(1, action.payload);
      state.selectedScheduleIds = [];
    },
    setTradieLimit(state, action: PayloadAction<number>) {
      state.pagination.limit = Math.max(1, Math.min(50, action.payload));
      state.pagination.page = 1;
      state.selectedScheduleIds = [];
    },
    resetTradieFilters(state) {
      state.filters = {
        search: "",
        projectId: null,
        tradeType: null,
        status: null,
        tab: "all",
        sortBy: "scheduledDate",
        sortOrder: "asc",
      };
      state.pagination.page = 1;
      state.selectedScheduleIds = [];
    },
    toggleScheduleSelection(state, action: PayloadAction<string>) {
      if (state.selectedScheduleIds.includes(action.payload)) {
        state.selectedScheduleIds = state.selectedScheduleIds.filter((id) => id !== action.payload);
      } else {
        state.selectedScheduleIds.push(action.payload);
      }
    },
    setSelectedSchedules(state, action: PayloadAction<string[]>) {
      state.selectedScheduleIds = action.payload;
    },
    clearSelectedSchedules(state) {
      state.selectedScheduleIds = [];
    },
    addPendingSchedule(state, action: PayloadAction<string>) {
      if (!state.pendingScheduleIds.includes(action.payload)) {
        state.pendingScheduleIds.push(action.payload);
      }
    },
    removePendingSchedule(state, action: PayloadAction<string>) {
      state.pendingScheduleIds = state.pendingScheduleIds.filter((scheduleId) => scheduleId !== action.payload);
    },
    flagReplacementRequired(state, action: PayloadAction<string>) {
      if (!state.replacementRequired.includes(action.payload)) {
        state.replacementRequired.push(action.payload);
      }
    },
    clearReplacementFlag(state, action: PayloadAction<string>) {
      state.replacementRequired = state.replacementRequired.filter((milestoneId) => milestoneId !== action.payload);
    },
  },
  extraReducers(builder) {
    builder
      .addCase(fetchTradieCoordinationDashboard.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTradieCoordinationDashboard.fulfilled, (state, action) => {
        const payload = action.payload;
        state.schedules = payload.schedules;
        state.pagination = {
          page: payload.pagination.page,
          limit: payload.pagination.limit,
          totalCount: payload.pagination.totalCount,
          totalPages: payload.pagination.totalPages,
        };
        state.summary = payload.summary;
        state.tabCounts = payload.tabCounts;
        state.tradeOptions = payload.tradeOptions;
        state.statusMetrics = payload.statusMetrics;
        state.tradeBreakdown = payload.tradeBreakdown;
        state.projectAllocations = payload.projectAllocations;
        state.utilizationTrend = payload.utilizationTrend;
        state.activity = payload.activity;
        state.urgentReminders = payload.urgentReminders;
        state.loading = false;

        const key = getQueryKey(state);
        state.lastQueryKey = key;
        state.cache[key] = { data: payload, fetchedAt: Date.now() };

        state.selectedScheduleIds = state.selectedScheduleIds.filter((id) => payload.schedules.some((row) => row.id === id));
      })
      .addCase(fetchTradieCoordinationDashboard.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load tradie coordination dashboard";
      })
      .addCase(fetchTradieProjectLookup.pending, (state, action) => {
        if ((action.meta.arg.page ?? 1) > 1 && state.projectLookup.items.length > 0) {
          state.projectLookup.loadingMore = true;
        } else {
          state.projectLookup.loading = true;
          state.projectLookup.items = [];
        }
        state.projectLookup.error = null;
      })
      .addCase(fetchTradieProjectLookup.fulfilled, (state, action) => {
        const isFirstPage = (action.meta.arg.page ?? 1) === 1;
        const nextItems = action.payload.items;

        state.projectLookup.items = isFirstPage
          ? nextItems
          : [
            ...state.projectLookup.items,
            ...nextItems.filter((item) => !state.projectLookup.items.some((existing) => existing.id === item.id)),
          ];
        state.projectLookup.page = action.payload.page;
        state.projectLookup.limit = action.payload.limit;
        state.projectLookup.totalCount = action.payload.totalCount;
        state.projectLookup.totalPages = action.payload.totalPages;
        state.projectLookup.loading = false;
        state.projectLookup.loadingMore = false;
      })
      .addCase(fetchTradieProjectLookup.rejected, (state, action) => {
        state.projectLookup.loading = false;
        state.projectLookup.loadingMore = false;
        state.projectLookup.error = action.error.message ?? "Failed to load projects";
      });

    builder
      .addCase(createTradieSchedule.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createTradieSchedule.fulfilled, (state, action) => {
        state.loading = false;
        // insert the newly created schedule at the top for visibility
        state.schedules = [action.payload, ...state.schedules];
        state.pagination.totalCount = state.pagination.totalCount + 1;
      })
      .addCase(createTradieSchedule.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to create schedule";
      });

    builder
      .addCase(updateTradieScheduleStatus.pending, (state, action) => {
        const scheduleId = action.meta.arg.scheduleId;
        if (!state.pendingScheduleIds.includes(scheduleId)) {
          state.pendingScheduleIds.push(scheduleId);
        }
        state.error = null;
      })
      .addCase(updateTradieScheduleStatus.fulfilled, (state, action) => {
        const { schedule } = action.payload;
        // remove from pending
        state.pendingScheduleIds = state.pendingScheduleIds.filter((id) => id !== schedule.id);

        // update schedule in-place immutably
        const idx = state.schedules.findIndex((s) => s.id === schedule.id);
        if (idx >= 0) {
          state.schedules[idx] = { ...state.schedules[idx], ...schedule };
        } else {
          state.schedules = [schedule, ...state.schedules];
        }

        // if (requiresReplacement && schedule.milestoneId) {
        //   if (!state.replacementRequired.includes(schedule.milestoneId)) {
        //     state.replacementRequired.push(schedule.milestoneId);
        //   }
        // }
      })
      .addCase(updateTradieScheduleStatus.rejected, (state, action) => {
        const scheduleId = action.meta.arg.scheduleId;
        state.pendingScheduleIds = state.pendingScheduleIds.filter((id) => id !== scheduleId);
        state.error = action.error.message ?? "Failed to update schedule status";
      });
  },
});

export const {
  hydrateTradieCoordination,
  setTradies,
  setTradieFilters,
  setTradiePage,
  setTradieLimit,
  resetTradieFilters,
  toggleScheduleSelection,
  setSelectedSchedules,
  clearSelectedSchedules,
  addPendingSchedule,
  removePendingSchedule,
  flagReplacementRequired,
  clearReplacementFlag,
} = tradiesSlice.actions;

export default tradiesSlice.reducer;
