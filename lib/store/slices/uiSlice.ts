import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ModalType =
  | "addUpdate"
  | "createVariation"
  | "scheduleTradie"
  | "logCall"
  | "confirmStatus"
  | "tradieDirectory"
  | "createProject"
  | "createMilestone"
  | "createTradie"
  | "tradieReminder"
  | "tradieScheduleDetails"
  | "projectDetail"
  | "addMaterial"
  | null;

export type UIModalPayload = Record<string, unknown> | null;

export interface UIState {
  modal: {
    type: ModalType;
    payload: UIModalPayload;
  };
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
  projectFilters: {
    status: null,
    view: "grid",
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
      state.projectFilters.status = null;
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
  setProjectFilter,
  setProjectView,
  setProjectSearchQuery,
  setProjectSort,
  clearProjectFilters,
  setTradieFilter,
} = uiSlice.actions;
export default uiSlice.reducer;