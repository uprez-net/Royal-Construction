import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ModalType =
  | "addUpdate"
  | "createVariation"
  | "scheduleTradie"
  | "logCall"
  | "confirmStatus"
  | "tradieDirectory"
  | "createProject"
  | "tradieReminder"
  | "tradieScheduleDetails"
  | "deleteTradieSchedule"
  | "projectDetail"
  | "addMaterial"
  | "viewPicture"
  | "addMilestone"
  | "addMilestonePicture"
  | "updateMilestoneStatus"
  | "insuranceClaimDates"
  | "createOfferFile"
  | "createLead"
  | "followUpPrompt"
  | "meetingReview"
  | "leadStatsDrilldown"
  | "addTradie"
  | "editTradie"
  | "deleteTradie"
  | "rateTradie"
  | "reportTradie"
  | "priceChangeTradie"
  | "adminApproval"
  | "approvalDetails"
  | "rejectTradieApprovals"
  | "previewFile"
  | null;

export type UIModalPayload = Record<string, unknown> | null;

/**
 * The status the project list opens on. Delivery works out of the in-flight
 * projects, so a completed one is noise until someone asks for it by pressing
 * the "Completed" chip.
 *
 * Anything that resets the filters has to come back here rather than to `null`,
 * or the default would only ever apply to a freshly created store.
 */
export const DEFAULT_PROJECT_STATUS_FILTER = "ACTIVE";

export interface UIState {
  modal: {
    type: ModalType;
    payload: UIModalPayload;
  };
  /**
   * Bumped whenever a task is closed, reopened or created from somewhere the
   * Tasks tab cannot reach — which is both review dialogs, since they are
   * rendered by the modal manager and have no handle on the tab's state.
   *
   * They called router.refresh(), which re-renders server components and can
   * do nothing for a list held in client useState. The row stayed on screen
   * until a manual reload, so a completed task still looked outstanding.
   */
  leadTasksVersion: number;
  projectFilters: {
    status: string | null;
    view: "grid" | "list";
    searchQuery: string;
    sortBy: "name" | "progress" | "budget" | "startDate" | "spent";
    sortOrder: "asc" | "desc";
  };
  tradieFilters: {
    tradeType: string | null;
    status: string | null;
    sort: "scheduledDate" | "tradieName" | "projectName";
    order: "asc" | "desc";
  };
}

const initialState: UIState = {
  modal: {
    type: null,
    payload: null,
  },
  leadTasksVersion: 0,
  projectFilters: {
    status: DEFAULT_PROJECT_STATUS_FILTER,
    view: "list",
    searchQuery: "",
    sortBy: "name",
    sortOrder: "asc",
  },
  tradieFilters: {
    tradeType: null,
    status: null,
    sort: "scheduledDate",
    order: "asc",
  },
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    openModal(state, action: PayloadAction<{ type: Exclude<ModalType, null>; payload?: UIModalPayload }>) {
      state.modal.type = action.payload.type;
      state.modal.payload = action.payload.payload ?? null;
    },
    closeModal(state) {
      state.modal.type = null;
      state.modal.payload = null;
    },
    /** Tell every open task list that the tasks it is showing have changed. */
    bumpLeadTasks(state) {
      state.leadTasksVersion += 1;
    },
    setProjectFilter(state, action: PayloadAction<{ status: string | null }>) {
      state.projectFilters.status = action.payload.status;
    },
    setProjectView(state, action: PayloadAction<"grid" | "list">) {
      state.projectFilters.view = action.payload;
    },
    setProjectSearchQuery(state, action: PayloadAction<string>) {
      state.projectFilters.searchQuery = action.payload;
    },
    setProjectSort(state, action: PayloadAction<{ sortBy: UIState["projectFilters"]["sortBy"]; sortOrder?: "asc" | "desc" }>) {
      state.projectFilters.sortBy = action.payload.sortBy;
      if (action.payload.sortOrder) {
        state.projectFilters.sortOrder = action.payload.sortOrder;
      }
    },
    clearProjectFilters(state) {
      state.projectFilters.searchQuery = "";
      state.projectFilters.status = DEFAULT_PROJECT_STATUS_FILTER;
      state.projectFilters.sortBy = "name";
      state.projectFilters.sortOrder = "asc";
    },
    setTradieFilter(
      state,
      action: PayloadAction<Partial<UIState["tradieFilters"]>>,
    ) {
      state.tradieFilters = { ...state.tradieFilters, ...action.payload };
    },
  },
});

export const {
  openModal,
  closeModal,
  bumpLeadTasks,
  setProjectFilter,
  setProjectView,
  setProjectSearchQuery,
  setProjectSort,
  clearProjectFilters,
  setTradieFilter,
} = uiSlice.actions;
export default uiSlice.reducer;