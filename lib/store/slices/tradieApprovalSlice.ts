import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import {
  ApprovalKPI,
  PaginatedTradieApprovals,
  TradieApprovalQuery,
} from "@/types/tradie-approvals";
import {
  fetchApprovalKPI,
  fetchTradieApprovals,
  handleBulkAdminApproval,
} from "@/lib/data/tradie-approvals";
import {
  ApprovalInput,
  SafeTradieApproval,
  ScheduleDeletionJsonPayload,
  TradeCancellationJsonPayload,
} from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { toast } from "sonner";
import {
  needsReviewWindow,
  sameListQuery,
  staleRowsAfterFailedReload,
} from "@/lib/tradie-approvals/queue-order";

const zeroByType = () =>
  Object.fromEntries(
    Object.values(TradieApprovalActionType).map((type) => [type, 0]),
  ) as Record<TradieApprovalActionType, number>;

const emptyKPI: ApprovalKPI = {
  waiting: 0,
  decided: 0,
  dueThisWeek: 0,
  oldestWaiting: null,
  waitingByType: zeroByType(),
  decidedByType: zeroByType(),
};

interface TradieApprovalState extends PaginatedTradieApprovals {
  selectedApprovalIds: string[];
  /** The newest list fetch. Only its response may fill the list: a slower
   * earlier one (a search typed past, a view left) must not overwrite it. */
  latestFetchId: string | null;
  /** The newest counts request; the same rule as latestFetchId, for the KPI. */
  latestKpiId: string | null;
  /** The query the rows on screen answer; null until a fetch has filled them. */
  rowsQuery: TradieApprovalQuery | null;
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
  selectedApprovalIds: [],
  latestFetchId: null,
  latestKpiId: null,
  rowsQuery: null,
  kpiData: emptyKPI,
  query: {
    view: "needs-decision",
    search: "",
    page: 1,
    pageSize: 10,
  },
  loading: false,
  error: null,
};

export const approvalTypeLabel: Record<TradieApprovalActionType, string> = {
  PRICE_CHANGE: "Price Change",
  INCIDENT_RESOLUTION: "Incident",
  TRADIE_REMOVAL: "Deletion",
  SCHEDULE_APPROVAL: "Scheduling",
  SCHEDULE_DELETION: "Schedule Removal",
  TRADE_CANCELLATION: "Trade Cancellation",
};

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A stored Sydney YYYY-MM-DD as "3 Nov". UTC, so no browser zone can shift it. */
export function approvalDayLabel(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** Approving these cancels bookings, so the office confirms first. A removal is
 * not here: it goes through its review window (see needsReviewWindow). */
export function cancelsBookings(approval: SafeTradieApproval): boolean {
  return (
    approval.actionType === "SCHEDULE_DELETION"
    || approval.actionType === "TRADE_CANCELLATION"
  );
}

/** What approving a cancelling request does, in the words the office sees. */
export function cancellationSummary(approval: SafeTradieApproval): string {
  const name = approval.tradie.name;
  if (approval.actionType === "SCHEDULE_DELETION") {
    const data = approval.updationData as ScheduleDeletionJsonPayload;
    // The booking date falls back to the submitted date when it does not parse;
    // say so rather than name the wrong day.
    const when =
      approval.dueKind === "booking"
        ? `for ${approvalDayLabel(approval.decisionDue)}`
        : "on an unrecorded date";
    return `Approving deletes ${name}'s booking on ${data?.projectName ?? "the project"} ${when}.`;
  }
  const data = approval.updationData as TradeCancellationJsonPayload;
  const count = data?.openBookings;
  const bookings =
    typeof count !== "number"
      ? "open bookings"
      : `${count} open ${count === 1 ? "booking" : "bookings"}`;
  const trade = data?.trade ?? approval.tradie.trade;
  return `Approving cancels ${name}'s ${bookings}${trade ? ` for ${trade}` : ""} on ${data?.projectName ?? "the project"}.`;
}

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
 * The reload after a decision. It shares fetchApprovalsByQuery's result, but
 * a failure keeps the rows on screen and says the list may be out of date:
 * the decision itself went through, so replacing the table with an error
 * would read as if it had not. The exception is rows from another view (a
 * view switch this reload superseded): those are fetched again instead.
 */
const reloadAfterDecision = createAsyncThunk<
  PaginatedTradieApprovals,
  TradieApprovalQuery,
  { state: ApprovalSliceState }
>(
  "tradieApproval/reloadAfterDecision",
  async (query, { dispatch, getState, requestId }) => {
    try {
      return await fetchTradieApprovals(query);
    } catch (error) {
      console.error("Approvals reload after a decision failed", error);
      const state = getState().tradieApproval;
      if (
        state.latestFetchId === requestId
        && staleRowsAfterFailedReload(state.rowsQuery, state.query)
      ) {
        void dispatch(fetchApprovalsByQuery(state.query));
      } else {
        toast.warning(
          "Saved, but the list could not be reloaded. Refresh the page to see it.",
        );
      }
      throw error;
    }
  },
);

/** The counts after a decision; on failure the office is told they are stale. */
async function reloadKpi(): Promise<ApprovalKPI | null> {
  try {
    return await fetchApprovalKPI();
  } catch (error) {
    console.error("Approval counts reload after a decision failed", error);
    toast.warning(
      "Saved, but the counts could not be refreshed. Refresh the page to update them.",
    );
    return null;
  }
}

/**
 * Reload the counts. Its own request, so the newest READ wins: two decisions
 * finishing out of order must not let an older read's counts stick, and a
 * later read (which sees both decisions) must not be dropped for having been
 * started by an earlier decision.
 */
const reloadApprovalKpi = createAsyncThunk<ApprovalKPI | null>(
  "tradieApproval/reloadApprovalKpi",
  () => reloadKpi(),
);

// needsReviewWindow lives with the queue rules; re-exported for the screen.
export { needsReviewWindow };

/** The approve input for one request: the payload its type needs, if any. */
export function approveInput(approval: SafeTradieApproval): ApprovalInput {
  const payload = (() => {
    switch (approval.actionType) {
      case "PRICE_CHANGE":
        return {
          newHourlyRate: (approval.updationData as { newHourlyRate: number })
            .newHourlyRate,
        };
      // Never sent from here: an incident is resolved in its review window,
      // which asks for the resolution note. Sending the word "approved" here
      // stored it as the incident's resolution.
      default:
        return undefined;
    }
  })();
  return {
    approvalId: approval.id,
    resolution: "approved",
    type: approval.actionType,
    payload,
  } satisfies ApprovalInput;
}

/**
 * Resolve (approve or reject) one or more requests, then reload the list and
 * the counts from the server, so a row that left the current view (approved
 * while "Pending" is shown) goes, and the counts are the server's, not a
 * local tally. Fulfils even when some failed: the caller reads `failed` and
 * says which. Rejects only when nothing resolved.
 */
export const approveRequests = createAsyncThunk<
  ApprovalBatch,
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
    void dispatch(reloadApprovalKpi());
    void dispatch(reloadAfterDecision(getState().tradieApproval.query));
    return batch;
  },
);

/**
 * Reload the list and the counts. For a request resolved outside the list
 * (its review window), which otherwise still showed as pending.
 */
export const refreshApprovals = createAsyncThunk<
  void,
  void,
  { state: ApprovalSliceState }
>("tradieApproval/refreshApprovals", async (_, { dispatch, getState }) => {
  void dispatch(reloadApprovalKpi());
  void dispatch(reloadAfterDecision(getState().tradieApproval.query));
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
        : `${failed} request${failed === 1 ? "" : "s"} not ${verb}: ${[
            ...new Set(result.failed.map((item) => item.error)),
          ]
            .slice(0, 3)
            .join("; ")}`,
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
    selectApproval(state, action: PayloadAction<string>) {
      if (!state.selectedApprovalIds.includes(action.payload)) {
        state.selectedApprovalIds.push(action.payload);
      } else {
        state.selectedApprovalIds = state.selectedApprovalIds.filter(
          (id) => id !== action.payload,
        );
      }
    },
    /** Select or clear a set of ids at once: the page's select-all box. */
    selectApprovals(
      state,
      action: PayloadAction<{ ids: string[]; selected: boolean }>,
    ) {
      const ids = new Set(action.payload.ids);
      state.selectedApprovalIds = action.payload.selected
        ? [...new Set([...state.selectedApprovalIds, ...ids])]
        : state.selectedApprovalIds.filter((id) => !ids.has(id));
    },
    clearState() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchApprovalsByQuery.pending, (state, action) => {
        state.latestFetchId = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(reloadAfterDecision.pending, (state, action) => {
        state.latestFetchId = action.meta.requestId;
      })
      .addCase(reloadAfterDecision.fulfilled, (state, action) => {
        // Same guard as fetchApprovalsByQuery: an older reload must not
        // overwrite a newer view, and a reload for a view left is dropped.
        if (action.meta.requestId !== state.latestFetchId) return;
        state.loading = false;
        if (!sameListQuery(action.meta.arg, state.query)) return;
        state.error = null;
        state.approvals = action.payload.approvals;
        state.totalCount = action.payload.totalCount;
        state.page = action.payload.page;
        state.pageSize = action.payload.pageSize;
        state.query.page = action.payload.page;
        state.selectedApprovalIds = state.selectedApprovalIds.filter((id) =>
          action.payload.approvals.some(
            (approval) => approval.id === id && approval.status === "PENDING",
          ),
        );
        state.rowsQuery = { ...state.query };
      })
      .addCase(reloadAfterDecision.rejected, (state, action) => {
        if (action.meta.requestId === state.latestFetchId)
          state.loading = false;
      })
      .addCase(fetchApprovalsByQuery.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.latestFetchId) return;
        state.loading = false;
        // A result for a view the office has since left is not theirs.
        if (!sameListQuery(action.meta.arg, state.query)) return;
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
        state.rowsQuery = { ...state.query };
      })
      .addCase(fetchApprovalsByQuery.rejected, (state, action) => {
        if (action.meta.requestId !== state.latestFetchId) return;
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
      })
      // A refused approval is reported by the caller's toast. It is not a
      // list error: setting `error` replaced the whole table with a message.
      .addCase(reloadApprovalKpi.pending, (state, action) => {
        state.latestKpiId = action.meta.requestId;
      })
      .addCase(reloadApprovalKpi.fulfilled, (state, action) => {
        if (action.payload && action.meta.requestId === state.latestKpiId) {
          state.kpiData = action.payload;
        }
      });
  },
});

export const {
  setQuery,
  setKPIData,
  setApprovalData,
  selectApproval,
  selectApprovals,
  clearState,
} = tradieApprovalSlice.actions;
export default tradieApprovalSlice.reducer;
