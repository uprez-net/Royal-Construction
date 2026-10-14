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
  | "rescheduleTradie"
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
  | "startCertifierEngagement"
  | "certifierDiscovery"
  | "certifierPackReady"
  | "certifierExtract"
  | "certifierSendSignedCopies"
  | "complianceComplete"
  | "complianceReject"
  | "connectComplianceParty"
  | "requestCompliancePartyRevision"
  | "developerDecision"
  | "developerResend"
  | "resubmitApplication"
  | "resolveComplianceAlert"
  | "scheduleComplianceMeeting"
  | "resolveComplianceMeeting"
  | "complianceApplication"
  | "requestWasteManagementPlan"
  | "reviewArchitectPlans"
  | null;

export type UIModalPayload = Record<string, unknown> | null;

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
  /**
   * The project list's grid/table toggle. The list's status chip, page,
   * search and sort are in the /projects URL instead
   * (components/projects/projects-list-url.ts), so coming back from a project
   * finds them where they were.
   */
  projectFilters: {
    view: "grid" | "list";
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
    view: "list",
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
    openModal(
      state,
      action: PayloadAction<{
        type: Exclude<ModalType, null>;
        payload?: UIModalPayload;
      }>,
    ) {
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
    setProjectView(state, action: PayloadAction<"grid" | "list">) {
      state.projectFilters.view = action.payload;
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
  setProjectView,
  setTradieFilter,
} = uiSlice.actions;
export default uiSlice.reducer;
