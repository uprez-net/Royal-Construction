import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Prisma } from "@prisma/client";

export type TradieRecord = Prisma.TradieGetPayload<Record<string, never>>;

export interface TradiesState {
  tradies: TradieRecord[];
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
    setTradies(state, action: PayloadAction<TradieRecord[]>) {
      state.tradies = action.payload;
    },
    appendTradie(state, action: PayloadAction<TradieRecord>) {
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