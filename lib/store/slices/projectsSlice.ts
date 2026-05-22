import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "@/lib/store";
import type { ProjectDetailTabKey } from "@/types/ui";
import {
  type AddProjectUpdateRequest,
  type CreateProjectRequest,
  type CreateVariationRequest,
  type ProjectDetail,
  type ProjectMutationState,
  type ProjectUploadRecord,
  type ProjectWithStats,
} from "@/types/project";
import { fetchJson } from "@/utils/fetch";
import { AddMaterialInput } from "@/utils/validators/material";

type MutationKey = "createProject" | "createVariation" | "addUpdate" | "addMaterial";

type ProjectsMutationState = Record<MutationKey, ProjectMutationState>;

type ProjectUploadState = Record<string, Record<string, ProjectUploadRecord>>;

export interface ProjectsState {
  projects: ProjectWithStats[];
  activeProject: ProjectDetail | null;
  optimisticUpdates: Record<string, Partial<Record<string, unknown>>>;
  mutations: ProjectsMutationState;
  uploadsByProjectId: ProjectUploadState;
  detailUi: {
    byProjectId: Record<
      string,
      {
        activeTab: ProjectDetailTabKey;
        activityFilter: "all" | "site-updates" | "milestones";
        chartRange: "monthly" | "quarterly";
      }
    >;
  };
}

const defaultDetailUiState = {
  activeTab: "overview",
  activityFilter: "all",
  chartRange: "monthly",
} as const;

const initialMutationState = (): ProjectsMutationState => ({
  createProject: { status: "idle", error: null },
  createVariation: { status: "idle", error: null },
  addUpdate: { status: "idle", error: null },
  addMaterial: { status: "idle", error: null },
});

const initialState: ProjectsState = {
  projects: [],
  activeProject: null,
  optimisticUpdates: {},
  mutations: initialMutationState(),
  uploadsByProjectId: {},
  detailUi: {
    byProjectId: {},
  },
};

function toProjectListItem(project: ProjectDetail): ProjectWithStats {
  const milestoneCount = project.milestones.length;
  const completedMilestoneCount = project.milestones.filter((milestone) => milestone.status === "DONE").length;
  const progressPercent = milestoneCount === 0 ? 0 : Math.round((completedMilestoneCount / milestoneCount) * 100);
  const approvedVariationSpend = project.variations
    .filter((variation) => variation.status === "APPROVED")
    .reduce((sum, variation) => sum + Number(variation.cost), 0)
    .toString();

  return {
    ...project,
    approvedVariationSpend,
    milestones: project.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      targetDate: milestone.targetDate,
      actualDate: milestone.actualDate,
      status: milestone.status,
      tradies: milestone.tradieSchedules.map((schedule) => ({
        name: schedule.tradie.name,
        company: schedule.tradie.company,
        tradeType: schedule.tradie.tradeType,
      })),
    })),
    milestoneCount,
    completedMilestoneCount,
    progressPercent,
  };
}

function syncProjectState(state: ProjectsState, project: ProjectDetail) {
  const nextProject = toProjectListItem(project);
  const existingIndex = state.projects.findIndex((item) => item.id === project.id);

  if (existingIndex >= 0) {
    state.projects[existingIndex] = nextProject;
  } else {
    state.projects.unshift(nextProject);
  }

  if (state.activeProject?.id === project.id) {
    state.activeProject = project;
  }

  delete state.optimisticUpdates[project.id];
  delete state.uploadsByProjectId[project.id];
}

export const createProject = createAsyncThunk<
  ProjectDetail,
  CreateProjectRequest,
  { rejectValue: string }
>("projects/createProject", async (payload, thunkApi) => {
  try {
    const response = await fetchJson<ProjectDetail>(
      "/api/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to create project",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to create project");
  }
});

export const addMaterialToProject = createAsyncThunk<
  ProjectDetail,
  AddMaterialInput,
  { rejectValue: string }
>("projects/addMaterial", async (payload, thunkApi) => {
  try {
    const response = await fetchJson<ProjectDetail>(
      `/api/material`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to add material to project",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to add material to project");
  }
});

export const createVariation = createAsyncThunk<
  ProjectDetail,
  CreateVariationRequest,
  { rejectValue: string }
>("projects/createVariation", async ({ projectId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<ProjectDetail>(
      `/api/projects/${projectId}/variations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to create variation",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to create variation");
  }
});

export const addProjectUpdate = createAsyncThunk<
  ProjectDetail,
  AddProjectUpdateRequest,
  { rejectValue: string }
>("projects/addUpdate", async ({ projectId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<ProjectDetail>(
      `/api/projects/${projectId}/updates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to add site update",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to add site update");
  }
});

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
    setProjects(state, action: PayloadAction<ProjectWithStats[]>) {
      state.projects = [...action.payload];
    },
    setActiveProject(state, action: PayloadAction<ProjectDetail | null>) {
      state.activeProject = action.payload;
    },
    syncProjectFromDetail(state, action: PayloadAction<ProjectDetail>) {
      syncProjectState(state, action.payload);
    },
    registerProjectUpload(
      state,
      action: PayloadAction<{
        projectId: string;
        fileId: string;
        fileName: string;
        fileSize: number;
      }>,
    ) {
      const projectUploads = state.uploadsByProjectId[action.payload.projectId] ?? {};

      projectUploads[action.payload.fileId] = {
        id: action.payload.fileId,
        fileName: action.payload.fileName,
        fileSize: action.payload.fileSize,
        progress: 0,
        status: "queued",
        url: null,
        error: null,
      };

      state.uploadsByProjectId[action.payload.projectId] = projectUploads;
    },
    updateProjectUploadProgress(
      state,
      action: PayloadAction<{
        projectId: string;
        fileId: string;
        progress: number;
      }>,
    ) {
      const upload = state.uploadsByProjectId[action.payload.projectId]?.[action.payload.fileId];

      if (!upload) {
        return;
      }

      upload.status = "uploading";
      upload.progress = Math.max(0, Math.min(100, Math.round(action.payload.progress)));
      upload.error = null;
    },
    completeProjectUpload(
      state,
      action: PayloadAction<{
        projectId: string;
        fileId: string;
        url: string;
      }>,
    ) {
      const upload = state.uploadsByProjectId[action.payload.projectId]?.[action.payload.fileId];

      if (!upload) {
        return;
      }

      upload.status = "completed";
      upload.progress = 100;
      upload.url = action.payload.url;
      upload.error = null;
    },
    failProjectUpload(
      state,
      action: PayloadAction<{
        projectId: string;
        fileId: string;
        error: string;
      }>,
    ) {
      const upload = state.uploadsByProjectId[action.payload.projectId]?.[action.payload.fileId];

      if (!upload) {
        return;
      }

      upload.status = "failed";
      upload.error = action.payload.error;
    },
    clearProjectUploads(state, action: PayloadAction<string>) {
      delete state.uploadsByProjectId[action.payload];
    },
    setProjectDetailTab(state, action: PayloadAction<{ projectId: string; tab: ProjectDetailTabKey }>) {
      const current = state.detailUi.byProjectId[action.payload.projectId] ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        activeTab: action.payload.tab,
      };
    },
    setProjectDetailActivityFilter(
      state,
      action: PayloadAction<{ projectId: string; filter: "all" | "site-updates" | "milestones" }>,
    ) {
      const current = state.detailUi.byProjectId[action.payload.projectId] ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        activityFilter: action.payload.filter,
      };
    },
    setProjectDetailChartRange(state, action: PayloadAction<{ projectId: string; range: "monthly" | "quarterly" }>) {
      const current = state.detailUi.byProjectId[action.payload.projectId] ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        chartRange: action.payload.range,
      };
    },
    resetProjectDetailUiState(state, action: PayloadAction<string>) {
      delete state.detailUi.byProjectId[action.payload];
    },
  },
  extraReducers(builder) {
    builder
      .addCase(createProject.pending, (state) => {
        state.mutations.createProject = { status: "pending", error: null };
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.mutations.createProject = { status: "succeeded", error: null };
        syncProjectState(state, action.payload);
      })
      .addCase(createProject.rejected, (state, action) => {
        state.mutations.createProject = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to create project",
        };
      })
      .addCase(createVariation.pending, (state) => {
        state.mutations.createVariation = { status: "pending", error: null };
      })
      .addCase(createVariation.fulfilled, (state, action) => {
        state.mutations.createVariation = { status: "succeeded", error: null };
        syncProjectState(state, action.payload);
      })
      .addCase(createVariation.rejected, (state, action) => {
        state.mutations.createVariation = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to create variation",
        };
      })
      .addCase(addProjectUpdate.pending, (state) => {
        state.mutations.addUpdate = { status: "pending", error: null };
      })
      .addCase(addProjectUpdate.fulfilled, (state, action) => {
        state.mutations.addUpdate = { status: "succeeded", error: null };
        syncProjectState(state, action.payload);
      })
      .addCase(addProjectUpdate.rejected, (state, action) => {
        state.mutations.addUpdate = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to add site update",
        };
      })
      .addCase(addMaterialToProject.pending, (state) => {
        state.mutations.addMaterial = { status: "pending", error: null };
      })
      .addCase(addMaterialToProject.fulfilled, (state, action) => {
        state.mutations.addMaterial = { status: "succeeded", error: null };
        syncProjectState(state, action.payload);
      })
      .addCase(addMaterialToProject.rejected, (state, action) => {
        state.mutations.addMaterial = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to add material to project",
        };
      });
  },
});

export const {
  addOptimisticUpdate,
  clearOptimisticUpdate,
  setProjects,
  setActiveProject,
  syncProjectFromDetail,
  registerProjectUpload,
  updateProjectUploadProgress,
  completeProjectUpload,
  failProjectUpload,
  clearProjectUploads,
  setProjectDetailTab,
  setProjectDetailActivityFilter,
  setProjectDetailChartRange,
  resetProjectDetailUiState,
} = projectsSlice.actions;

export const selectProjectsState = (state: RootState) => state.projects;

export const selectProjectDetailUiState = (projectId: string) =>
  createSelector(selectProjectsState, (projectsState) => {
    return projectsState.detailUi.byProjectId[projectId] ?? defaultDetailUiState;
  });

export const selectProjectUploadQueue = (projectId: string) =>
  createSelector(selectProjectsState, (projectsState) => projectsState.uploadsByProjectId[projectId] ?? {});

export const selectActiveProjectBudgetSummary = createSelector(selectProjectsState, (projectsState) => {
  const project = projectsState.activeProject;

  if (!project) {
    return null;
  }

  const totalBudget = Number(project.totalBudget);
  const spent = Number(project.spent);
  const remaining = Math.max(totalBudget - spent, 0);
  const spentPercent = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;

  return {
    totalBudget,
    spent,
    remaining,
    spentPercent,
  };
});

export default projectsSlice.reducer;