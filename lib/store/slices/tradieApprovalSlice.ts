import {
    createAsyncThunk,
    createSlice,
    type PayloadAction,
} from "@reduxjs/toolkit";
import { ApprovalKPI, PaginatedTradieApprovals, TabKey, TradieApprovalQuery } from "@/types/tradie-approvals";
import { fetchTradieApprovals, handleBulkAdminApproval } from "@/lib/data/tradie-approvals";
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

export const fetchApprovalsByQuery = createAsyncThunk<PaginatedTradieApprovals, TradieApprovalQuery>(
    "tradieApproval/fetchApprovalsByQuery",
    async (query, { rejectWithValue }) => {
        try {
            const res = await fetchTradieApprovals(query);

            return res;
        } catch (error) {
            return rejectWithValue("Failed to fetch approvals");
        }
    });

export const approveRequests = createAsyncThunk<Awaited<ReturnType<typeof handleBulkAdminApproval>>, ApprovalInput[]>(
    "tradieApproval/approveRequests",
    async (inputs, { rejectWithValue }) => {
        try {
            const res = await handleBulkAdminApproval(inputs);

            return res;
        } catch (error) {
            return rejectWithValue("Failed to approve requests");
        }
    });

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
        }
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
                for (const approval of action.payload) {
                    const index = state.approvals.findIndex(a => a.id === approval.approvalId);
                    if (index !== -1) {
                        state.approvals[index].status = approval.resolution === "approved" ? "APPROVED" : "REJECTED";
                        state.kpiData.resolvedCount[approval.resolution === "approved" ? "accepted" : "rejected"] += 1;
                        state.kpiData.pendingCount -= 1;
                        switch (approval.actionType) {
                            case "PRICE_CHANGE":
                                state.kpiData.priceChangeCount -= 1;
                                break;
                            case "INCIDENT_RESOLUTION":
                                state.kpiData.incidentReportCount -= 1;
                                break;
                            case "TRADIE_REMOVAL":
                                state.kpiData.deletionCount -= 1;
                                break;
                            // case "SCHEDULE_APPROVAL":
                            //     state.kpiData.scheduleCount -= 1;
                            //     break;
                        }
                    }
                }
            })
            .addCase(approveRequests.rejected, (state, action) => {
                state.error = action.payload as string;
            });
    }
});

export const { setQuery, setKPIData, setApprovalData, setActiveTab, selectApproval, clearState } = tradieApprovalSlice.actions;
export default tradieApprovalSlice.reducer;