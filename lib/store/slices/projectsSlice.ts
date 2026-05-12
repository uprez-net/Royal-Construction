import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ProjectsState {
  optimisticUpdates: Record<string, Partial<Record<string, unknown>>>;
  pendingVariations: string[];
}

const initialState: ProjectsState = {
  optimisticUpdates: {},
  pendingVariations: [],
};

const projectsSlice = createSlice({
  name: "projects",
  initialState,
  reducers: {
    addOptimisticUpdate(state, action: PayloadAction<{ projectId: string; update: Partial<Record<string, unknown>> }>) {
      state.optimisticUpdates[action.payload.projectId] = {
        ...(state.optimisticUpdates[action.payload.projectId] ?? {}),
        ...action.payload.update,
      };
    },
    clearOptimisticUpdate(state, action: PayloadAction<string>) {
      delete state.optimisticUpdates[action.payload];
    },
    addPendingVariation(state, action: PayloadAction<string>) {
      if (!state.pendingVariations.includes(action.payload)) {
        state.pendingVariations.push(action.payload);
      }
    },
    removePendingVariation(state, action: PayloadAction<string>) {
      state.pendingVariations = state.pendingVariations.filter((variationId) => variationId !== action.payload);
    },
  },
});

export const { addOptimisticUpdate, clearOptimisticUpdate, addPendingVariation, removePendingVariation } = projectsSlice.actions;
export default projectsSlice.reducer;