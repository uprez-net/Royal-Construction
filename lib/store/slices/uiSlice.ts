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
    setTradieFilter(
      state,
      action: PayloadAction<Partial<UIState["tradieFilters"]>>,
    ) {
      state.tradieFilters = { ...state.tradieFilters, ...action.payload };
    },
  },
});

export const { openModal, closeModal, setProjectFilter, setProjectView, setTradieFilter } = uiSlice.actions;
export default uiSlice.reducer;