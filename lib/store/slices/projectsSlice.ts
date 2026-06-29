import { createAsyncThunk, createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { RootState } from "@/lib/store";

import {
  MilestoneWithFilesTradiesUpdates,
  SafeMaterial,
  SafeVariation,
  TradieScheduleListItem,
  type AddProjectUpdateRequest,
  type CreateVariationRequest,
  type ProjectDetail,
  type ProjectMutationState,
  type ProjectUploadRecord,
  type ProjectWithStats,
  type SafeMilestone,
} from "@/types/project";
import type { File as ProjectFiles } from "@prisma/client"
import { fetchJson } from "@/utils/fetch";
import type { MilestoneCreationData, AddMaterialInput, MilestoneUpdateData, MilestonePictureUploadData, ProjectDetailTabKey, CreateTradieScheduleInput } from "@/utils/validators";
import { createProjectWithLead, CreateProjectWithLeadInput } from "@/lib/data/projectsWrite";
import { bulkCreateTradieSchedules } from "@/lib/data/tradieSchedules";

type MutationKey = "createProject" | "createVariation" | "addUpdate" | "addMaterial" | "createTradieSchedule" | "addMilestone" | "updateMilestone" | "addMilestonePhotos";

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
  createTradieSchedule: { status: "idle", error: null },
  addMilestone: { status: "idle", error: null },
  updateMilestone: { status: "idle", error: null },
  addMilestonePhotos: { status: "idle", error: null },
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

function syncProjectState(state: ProjectsState, project: ProjectDetail) {
  if (state.activeProject?.id === project.id) {
    state.activeProject = { ...project, ...state.activeProject };
  }

  delete state.optimisticUpdates[project.id];
  delete state.uploadsByProjectId[project.id];
}

export const createProject = createAsyncThunk<
  ProjectDetail,
  CreateProjectWithLeadInput,
  { rejectValue: string }
>("projects/createProject", async (payload, thunkApi) => {
  try {
    const newProject = await createProjectWithLead(payload);
    return newProject;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to create project");
  }
});

export const addMaterialToProject = createAsyncThunk<
  SafeMaterial,
  AddMaterialInput,
  { rejectValue: string }
>("projects/addMaterial", async (payload, thunkApi) => {
  try {
    const response = await fetchJson<SafeMaterial>(
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
  SafeVariation,
  CreateVariationRequest,
  { rejectValue: string }
>("projects/createVariation", async ({ projectId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<SafeVariation>(
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

export const createTradieScheduleForProject = createAsyncThunk<
  TradieScheduleListItem,
  CreateTradieScheduleInput
>("tradies/createSchedule", async (payload) => {
  const response = await fetchJson<TradieScheduleListItem>(
    "/api/tradie-schedules",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to create tradie schedule"
  );

  return response.data;
});

export const createBulkTradieScheduleForProject = createAsyncThunk<
  TradieScheduleListItem[],
  CreateTradieScheduleInput[]
>("tradies/createBulkSchedule", async (payload, thunkApi) => {
  try {
    const data = await bulkCreateTradieSchedules(payload);

    return data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Failed to create tradie schedules");
  }
});

export const addProjectMilestone = createAsyncThunk<
  MilestoneWithFilesTradiesUpdates,
  MilestoneCreationData & { projectId: string },
  { rejectValue: string }
>("projects/addMilestone", async ({ projectId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<MilestoneWithFilesTradiesUpdates>(
      `/api/projects/${projectId}/milestones`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to add milestone to project",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to add milestone to project");
  }
});

export const updateProjectMilestoneStatus = createAsyncThunk<
  SafeMilestone,
  MilestoneUpdateData & { projectId: string; milestoneId: string },
  { rejectValue: string }
>("projects/updateMilestoneStatus", async ({ projectId, milestoneId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<SafeMilestone>(
      `/api/projects/${projectId}/milestones/${milestoneId}/updates`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to update milestone",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to update milestone");
  }
});

export const addMilestonePhotos = createAsyncThunk<
  { id: string; projectId: string; files: ProjectFiles[] },
  MilestonePictureUploadData & { projectId: string; milestoneId: string },
  { rejectValue: string }
>("projects/addMilestonePhotos", async ({ projectId, milestoneId, ...payload }, thunkApi) => {
  try {
    const response = await fetchJson<{ id: string; projectId: string; files: ProjectFiles[] }>(
      `/api/projects/${projectId}/milestones/${milestoneId}/add-photos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Unable to add photos to milestone",
    );

    return response.data;
  } catch (error) {
    return thunkApi.rejectWithValue(error instanceof Error ? error.message : "Unable to add photos to milestone");
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
      if (action.payload === state.activeProject?.id) {
        state.activeProject = null;
      }
      delete state.uploadsByProjectId[action.payload];
      delete state.detailUi.byProjectId[action.payload];
    },
    resetProjects(state) {
      state.projects = [];
      state.activeProject = null;
      state.optimisticUpdates = {};
      state.mutations = initialMutationState();
      state.uploadsByProjectId = {};
      state.detailUi.byProjectId = {};
    }
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
          error: action.error.message ?? "Unable to create project",
        };
      })
      .addCase(createVariation.pending, (state) => {
        state.mutations.createVariation = { status: "pending", error: null };
      })
      .addCase(createVariation.fulfilled, (state, action) => {
        state.mutations.createVariation = { status: "succeeded", error: null };
        if (state.activeProject?.id === action.payload.projectId) {
          state.activeProject.variations.push(action.payload);
        }
      })
      .addCase(createVariation.rejected, (state, action) => {
        state.mutations.createVariation = {
          status: "failed",
          error: action.error.message ?? "Unable to create variation",
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
          error: action.error.message ?? "Unable to add site update",
        };
      })
      .addCase(addMaterialToProject.pending, (state) => {
        state.mutations.addMaterial = { status: "pending", error: null };
      })
      .addCase(addMaterialToProject.fulfilled, (state, action) => {
        state.mutations.addMaterial = { status: "succeeded", error: null };
        if (state.activeProject?.id === action.payload.projectId) {
          state.activeProject.materials.push(action.payload);
        }
      })
      .addCase(addMaterialToProject.rejected, (state, action) => {
        state.mutations.addMaterial = {
          status: "failed",
          error: action.error.message ?? "Unable to add material to project",
        };
      })
      .addCase(createTradieScheduleForProject.pending, (state) => {
        state.mutations.createTradieSchedule = { status: "pending", error: null };
      })
      .addCase(createTradieScheduleForProject.fulfilled, (state, action) => {
        state.mutations.createTradieSchedule = { status: "succeeded", error: null };
        const schedule = action.payload;
        const milestone = state.activeProject?.milestones.find((m) => m.id === schedule.milestoneId);
        if (state.activeProject?.id === schedule.projectId) {
          state.activeProject.tradieSchedules.push({
            id: schedule.id,
            status: schedule.status,
            scheduledDate: new Date(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            tradieId: schedule.tradieId,
            tradie: {
              name: schedule.tradieName,
              id: schedule.tradieId,
              createdAt: new Date(),
              updatedAt: new Date(),
              email: schedule.contact.email,
              phone: schedule.contact.phone,
              trade: schedule.tradeType,
              abn: schedule.abn,
              isFavourite: schedule.isFavourite,
              note: null
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            projectId: schedule.projectId,
            milestoneId: schedule.milestoneId ?? null,
            reminderSentAt: schedule.reminderSentAt ? new Date(schedule.reminderSentAt) : null,
            milestone: milestone,
            requiresQuote: schedule.requiresQuote,
            quotedPrice: schedule.quotedPrice ?? null
          });
        }
      })
      .addCase(createTradieScheduleForProject.rejected, (state, action) => {
        state.mutations.createTradieSchedule = {
          status: "failed",
          error: (action.payload as string | null) ?? action.error.message ?? "Failed to create tradie schedule",
        };
      })
      .addCase(createBulkTradieScheduleForProject.pending, (state) => {
        state.mutations.createTradieSchedule = { status: "pending", error: null };
      })
      .addCase(createBulkTradieScheduleForProject.fulfilled, (state, action) => {
        state.mutations.createTradieSchedule = { status: "succeeded", error: null };
        const schedules = action.payload;
        if (state.activeProject !== null) {
          schedules.forEach((schedule) => {
            const milestone = state.activeProject!.milestones.find((m) => m.id === schedule.milestoneId);
            state.activeProject!.tradieSchedules.push({
              id: schedule.id,
              status: schedule.status,
              scheduledDate: new Date(schedule.scheduledDate),
              durationDays: schedule.durationDays,
              tradieId: schedule.tradieId,
              tradie: {
                name: schedule.tradieName,
                id: schedule.tradieId,
                createdAt: new Date(),
                updatedAt: new Date(),
                email: schedule.contact.email,
                phone: schedule.contact.phone,
                trade: schedule.tradeType,
                abn: schedule.abn,
                isFavourite: schedule.isFavourite,
                note: null
              },
              createdAt: new Date(),
              updatedAt: new Date(),
              projectId: schedule.projectId,
              milestoneId: schedule.milestoneId ?? null,
              reminderSentAt: schedule.reminderSentAt ? new Date(schedule.reminderSentAt) : null,
              milestone: milestone,
              requiresQuote: false,
              quotedPrice: null
            });
          });
        }
      })
      .addCase(createBulkTradieScheduleForProject.rejected, (state, action) => {
        state.mutations.createTradieSchedule = {
          status: "failed",
          error: (action.payload as string | null) ?? action.error.message ?? "Failed to create tradie schedules",
        };
      })
      .addCase(addProjectMilestone.pending, (state) => {
        state.mutations.addMilestone = { status: "pending", error: null };
      })
      .addCase(addProjectMilestone.fulfilled, (state, action) => {
        state.mutations.addMilestone = { status: "succeeded", error: null };
        if (state.activeProject?.id === action.payload.projectId) {
          state.activeProject.milestones.push(action.payload);
        }
      })
      .addCase(addProjectMilestone.rejected, (state, action) => {
        state.mutations.addMilestone = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to add milestone to project",
        };
      })
      .addCase(updateProjectMilestoneStatus.pending, (state) => {
        state.mutations.updateMilestone = { status: "pending", error: null };
      })
      .addCase(updateProjectMilestoneStatus.fulfilled, (state, action) => {
        state.mutations.updateMilestone = { status: "succeeded", error: null };
        if (state.activeProject?.id === action.payload.projectId) {
          const milestoneIndex = state.activeProject.milestones.findIndex((m) => m.id === action.meta.arg.milestoneId);
          if (milestoneIndex !== -1) {
            state.activeProject!.milestones[milestoneIndex] = { ...state.activeProject!.milestones[milestoneIndex], ...action.payload };
            const parentId = state.activeProject!.milestones[milestoneIndex].parentId;
            if (parentId && action.payload.status === "DONE") {
              const allChildrenMilestonesNotCompleted = state.activeProject!.milestones.filter((m) => m.parentId === parentId && m.status !== "DONE");
              if (allChildrenMilestonesNotCompleted.length === 0) {
                const parentIndex = state.activeProject!.milestones.findIndex((m) => m.id === parentId);
                const totalChildSpent = state.activeProject!.milestones.filter((m) => m.parentId === parentId).reduce((sum, m) => sum + (Number(m.spend) || 0), 0);
                if (parentIndex !== -1) {
                  state.activeProject!.milestones[parentIndex] = { ...state.activeProject!.milestones[parentIndex], status: "DONE", spend: totalChildSpent.toString(), actualDate: action.payload.actualDate };
                  state.activeProject!.spent = (Number(state.activeProject!.spent) + totalChildSpent).toString();
                }
              }
            }
            if (parentId && action.payload.status === "ACTIVE") {
              const parentIndex = state.activeProject!.milestones.findIndex((m) => m.id === parentId);
              if (parentIndex !== -1 && state.activeProject!.milestones[parentIndex].status !== "ACTIVE") {
                state.activeProject!.milestones[parentIndex] = { ...state.activeProject!.milestones[parentIndex], status: "ACTIVE", startDate: action.payload.startDate };
              }
            }
          }
        }
      })
      .addCase(updateProjectMilestoneStatus.rejected, (state, action) => {
        state.mutations.updateMilestone = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to update milestone status",
        };
      })
      .addCase(addMilestonePhotos.pending, (state) => {
        state.mutations.addMilestonePhotos = { status: "pending", error: null };
      })
      .addCase(addMilestonePhotos.fulfilled, (state, action) => {
        state.mutations.addMilestonePhotos = { status: "succeeded", error: null };
        if (state.activeProject?.id === action.payload.projectId) {
          const milestone = state.activeProject.milestones.find((m) => m.id === action.payload.id);
          if (milestone) {
            milestone.files.push(...action.payload.files);
          }
          state.activeProject.files.push(...action.payload.files);
        }
      })
      .addCase(addMilestonePhotos.rejected, (state, action) => {
        state.mutations.addMilestonePhotos = {
          status: "failed",
          error: action.payload ?? action.error.message ?? "Unable to add photos to milestone",
        };
      });
  }
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
  resetProjects,
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