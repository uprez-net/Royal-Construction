import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import {
  ApprovalKPI,
  PaginatedTradieApprovals,
  TabKey,
  TradieApprovalQuery,
} from "@/types/tradie-approvals";
import {
  fetchApprovalKPI,
  fetchTradieApprovals,
  handleBulkAdminApproval,
} from "@/lib/data/tradie-approvals";
import { ApprovalInput } from "@/types/tradie";

interface TradieApprovalState extends PaginatedTradieApprovals {
  selectedApprovalIds: string[];
  activeTab: TabKey;
  kpiData: ApprovalKPI;
  query: TradieApprovalQuery;
  loading: boolean;
  error: string | null;
}

const initialState: TradieApprovalState = {
  approvals: [],
  totalCount: 0,
  page: 1,
  pageSize: 10,
  activeTab: "all",
  selectedApprovalIds: [],
  kpiData: {
    pendingCount: 0,
    priceChangeCount: 0,
    incidentReportCount: 0,
    deletionCount: 0,
    scheduleCount: 0,
    scheduleDeletionCount: 0,
    resolvedCount: {
      accepted: 0,
      rejected: 0,
    },
  },
  query: {
    search: "",
    page: 1,
    pageSize: 10,
  },
  loading: false,
  error: null,
};

export const fetchApprovalsByQuery = createAsyncThunk<
  PaginatedTradieApprovals,
  TradieApprovalQuery
>(
  "tradieApproval/fetchApprovalsByQuery",
  async (query, { rejectWithValue }) => {
    try {
      const res = await fetchTradieApprovals(query);

      return res;
    } catch (error) {
      console.error("Error fetching approvals:", error);
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch approvals",
      );
    }
  },
);

type ApprovalBatch = Awaited<ReturnType<typeof handleBulkAdminApproval>>;
type ApprovalSliceState = { tradieApproval: TradieApprovalState };

/**
 * Resolve (approve or reject) one or more requests, then reload the list and
 * the counts from the server, so a row that left the current view (approved
 * while "Pending" is shown) goes, and the counts are the server's, not a
 * local tally. Fulfils even when some failed: the caller reads `failed` and
 * says which. Rejects only when nothing resolved.
 */
export const approveRequests = createAsyncThunk<
  ApprovalBatch & { kpi: ApprovalKPI | null },
  ApprovalInput[],
  { state: ApprovalSliceState; rejectValue: string }
>(
  "tradieApproval/approveRequests",
  async (inputs, { dispatch, getState, rejectWithValue }) => {
    let batch: ApprovalBatch;
    try {
      batch = await handleBulkAdminApproval(inputs);
    } catch (error) {
      console.error("Error approving requests:", error);
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to approve requests",
      );
    }
    if (batch.resolved.length === 0) {
      return rejectWithValue(
        batch.failed[0]?.error ?? "No request could be resolved",
      );
    }
    const kpi = await fetchApprovalKPI().catch(() => null);
    void dispatch(fetchApprovalsByQuery(getState().tradieApproval.query));
    return { ...batch, kpi };
  },
);

/**
 * Reload the list and the counts. For a request resolved outside the list
 * (its review window), which otherwise still showed as pending.
 */
export const refreshApprovals = createAsyncThunk<
  ApprovalKPI | null,
  void,
  { state: ApprovalSliceState }
>("tradieApproval/refreshApprovals", async (_, { dispatch, getState }) => {
  void dispatch(fetchApprovalsByQuery(getState().tradieApproval.query));
  return fetchApprovalKPI().catch(() => null);
});

/**
 * The message in a failed approveRequests: `unwrap()` throws the rejected
 * value, which is a string, not an Error, so an `instanceof Error` check fell
 * through to "An unexpected error occurred" and hid the real reason.
 */
export function approvalErrorMessage(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

/** What to tell the office after a batch: how many went, and why any did not. */
export function approvalOutcomeMessage(
  result: ApprovalBatch,
  verb: "approved" | "rejected",
): { success: string | null; failure: string | null } {
  const done = result.resolved.length;
  const failed = result.failed.length;
  return {
    success:
      done === 0 ? null : `${done} request${done === 1 ? "" : "s"} ${verb}`,
    failure:
      failed === 0
        ? null
        : `${failed} request${failed === 1 ? "" : "s"} not ${verb}: ${result.failed[0].error}`,
  };
}

const tradieApprovalSlice = createSlice({
  name: "tradieApproval",
  initialState,
  reducers: {
    setQuery(state, action: PayloadAction<Partial<TradieApprovalQuery>>) {
      state.query = { ...state.query, ...action.payload };
    },
    setKPIData(state, action: PayloadAction<ApprovalKPI>) {
      state.kpiData = action.payload;
    },
    setApprovalData(state, action: PayloadAction<PaginatedTradieApprovals>) {
      state.approvals = action.payload.approvals;
      state.totalCount = action.payload.totalCount;
      state.page = action.payload.page;
      state.pageSize = action.payload.pageSize;
    },
    setActiveTab(state, action: PayloadAction<TabKey>) {
      state.activeTab = action.payload;
    },
    selectApproval(state, action: PayloadAction<string>) {
      if (!state.selectedApprovalIds.includes(action.payload)) {
        state.selectedApprovalIds.push(action.payload);
      } else {
        state.selectedApprovalIds = state.selectedApprovalIds.filter(
          (id) => id !== action.payload,
        );
      }
    },
    clearState() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchApprovalsByQuery.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchApprovalsByQuery.fulfilled, (state, action) => {
        state.loading = false;
        state.approvals = action.payload.approvals;
        // Keep only selections still on screen and still pending.
        const selectable = new Set(
          action.payload.approvals
            .filter((approval) => approval.status === "PENDING")
            .map((approval) => approval.id),
        );
        state.selectedApprovalIds = state.selectedApprovalIds.filter((id) =>
          selectable.has(id),
        );
        state.totalCount = action.payload.totalCount;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
      })
      .addCase(fetchApprovalsByQuery.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(approveRequests.pending, (state) => {
        state.error = null;
      })
      .addCase(approveRequests.fulfilled, (state, action) => {
        const resolvedIds = new Set<string>();
        for (const approval of action.payload.resolved) {
          resolvedIds.add(approval.approvalId);
          const row = state.approvals.find((a) => a.id === approval.approvalId);
          if (row) {
            row.status =
              approval.resolution === "approved" ? "APPROVED" : "REJECTED";
            row.rejectionReason = approval.rejectReason ?? null;
          }
        }
        // A resolved request can no longer be selected; leaving it in the
        // selection kept "Approve N" on screen for requests already done.
        state.selectedApprovalIds = state.selectedApprovalIds.filter(
          (id) => !resolvedIds.has(id),
        );
        if (action.payload.kpi) state.kpiData = action.payload.kpi;
      })
      // A refused approval is reported by the caller's toast. It is not a
      // list error: setting `error` replaced the whole table with a message.
      .addCase(refreshApprovals.fulfilled, (state, action) => {
        if (action.payload) state.kpiData = action.payload;
      });
  },
});

export const {
  setQuery,
  setKPIData,
  setApprovalData,
  setActiveTab,
  selectApproval,
  clearState,
} = tradieApprovalSlice.actions;
export default tradieApprovalSlice.reducer;
