import { ProjectDetail, ProjectWithStats } from "@/types/project";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ProjectsState {
  projects: ProjectWithStats[];
  activeProject: ProjectDetail | null;
  optimisticUpdates: Record<string, Partial<Record<string, unknown>>>;
  pendingVariations: string[];
}

const initialState: ProjectsState = {
  projects: [],
  activeProject: null,
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
    setProjects(state, action: PayloadAction<ProjectWithStats[]>) {
      state.projects = action.payload;
    },
    setActiveProject(state, action: PayloadAction<ProjectDetail | null>) {
      state.activeProject = action.payload;
    },
  },
});

export const { addOptimisticUpdate, clearOptimisticUpdate, addPendingVariation, removePendingVariation, setProjects, setActiveProject } = projectsSlice.actions;
export default projectsSlice.reducer;