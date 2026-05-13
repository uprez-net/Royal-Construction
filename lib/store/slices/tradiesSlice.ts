import { SafeTradie } from "@/types/project";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";


export interface TradiesState {
  tradies: SafeTradie[];
  pendingScheduleIds: string[];
  replacementRequired: string[];
}

const initialState: TradiesState = {
  tradies: [],
  pendingScheduleIds: [],
  replacementRequired: [],
};

const tradiesSlice = createSlice({
  name: "tradies",
  initialState,
  reducers: {
    setTradies(state, action: PayloadAction<SafeTradie[]>) {
      state.tradies = action.payload;
    },
    appendTradie(state, action: PayloadAction<SafeTradie>) {
      state.tradies.push(action.payload);
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
});

export const { setTradies, appendTradie, addPendingSchedule, removePendingSchedule, flagReplacementRequired, clearReplacementFlag } = tradiesSlice.actions;
export default tradiesSlice.reducer;