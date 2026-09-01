import {
  createAsyncThunk,
  createSelector,
  createSlice,
  isAnyOf,
  type AsyncThunk,
  type PayloadAction,
} from "@reduxjs/toolkit";

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
  type BudgetSummary,
  TradieScheduleWithTradieAndMilestone,
} from "@/types/project";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
import type { ComplianceDocumentType, File as ProjectFiles } from "@prisma/client"
import { fetchJson } from "@/utils/fetch";
import type { CertifierEngagementDetail } from "@/types/compliance";
import type {
  CertifierReplyInput,
  ClassifyReceivedDocumentInput,
  ComplianceDocumentUploadInput,
  ResolveComplianceDocumentInput,
  SetComplianceDocumentNotRequiredInput,
  StartEngagementInput,
} from "@/utils/validators/compliance";
import type { MilestoneCreationData, AddMaterialInput, MilestoneUpdateData, MilestonePictureUploadData, ProjectDetailTabKey, CreateTradieScheduleInput } from "@/utils/validators";
import { createProjectWithLeadAction, CreateProjectWithLeadInput } from "@/lib/data/projectsWrite";
import {
  toCreateProjectFailure,
  type CreateProjectFailure,
} from "@/lib/projects/create-project-errors";
import { bulkCreateTradieSchedules } from "@/lib/data/tradieSchedules";

type MutationKey =
  | "createProject"
  | "createVariation"
  | "addUpdate"
  | "addMaterial"
  | "createTradieSchedule"
  | "addMilestone"
  | "updateMilestone"
  | "addMilestonePhotos";

type ProjectsMutationState = Record<MutationKey, ProjectMutationState>;

/**
 * In-flight compliance work, filed one entry per {@link ComplianceScope}.
 *
 * Absent means idle. Entries are written on the first request against a scope
 * and left behind afterwards, so a caller can read the outcome of the last
 * write to a row as well as whether one is running now.
 */
type ComplianceMutationState = Record<ComplianceScope, ProjectMutationState>;

type ProjectUploadState = Record<string, Record<string, ProjectUploadRecord>>;

export interface ProjectsState {
  projects: ProjectWithStats[];
  activeProject: ProjectDetail | null;
  optimisticUpdates: Record<string, Partial<Record<string, unknown>>>;
  mutations: ProjectsMutationState;
  /**
   * Compliance writes, tracked per scope rather than as one flag.
   *
   * Separate from `mutations` because it is keyed by a value rather than by a
   * fixed set of names — the tab has one scope per document row, and those are
   * only known once the engagement has been read.
   */
  complianceMutations: ComplianceMutationState;
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
  complianceMutations: {},
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

// Rejects with a structured `CreateProjectFailure` rather than a bare string:
// the create-project wizard binds each entry in `fieldErrors` to the input
// that produced it, which a flattened message cannot support.
export const createProject = createAsyncThunk<
  ProjectDetail,
  CreateProjectWithLeadInput,
  { rejectValue: CreateProjectFailure }
>("projects/createProject", async (payload, thunkApi) => {
  try {
    const result = await createProjectWithLeadAction(payload);
    if (!result.ok) {
      return thunkApi.rejectWithValue(result.failure);
    }
    return result.project;
  } catch (error) {
    // Only transport-level problems reach here — the action itself returns a
    // result instead of throwing.
    return thunkApi.rejectWithValue(toCreateProjectFailure(error));
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


/* -------------------------------------------------------------------------- */
/*                        Compliance and certification                        */
/* -------------------------------------------------------------------------- */

/**
 * The unit of "something is being written" on the compliance file.
 *
 * One shared flag was the wrong grain. The tab carries an upload control on
 * every document row plus four sends and a thread composer, and a single
 * `pending` disabled all of them for the duration of any one request — so
 * replacing a checklist photo froze the five rows beside it, the composer, and
 * the send bar, for as long as the transfer took.
 *
 * A scope is coarser than a thunk and finer than the tab: it names the thing
 * being written, not the request writing it. Two requests against the same row
 * still serialise, which is what anybody expects of Replace and Approve on one
 * document, while work on different rows runs side by side.
 */
export type ComplianceScope = string;

/** How a request names the row it is writing to. */
type ComplianceDocumentTarget = {
  documentId?: string | null;
  documentType?: ComplianceDocumentType | null;
};

export const complianceScope = {
  /** Opening the engagement — nothing else exists yet, so it stands alone. */
  engagement: "engagement" as ComplianceScope,
  /** The required pack going out to the certifier. */
  outreach: "outreach" as ComplianceScope,
  /** Both signed forms going back. */
  signedCopies: "signed-copies" as ComplianceScope,
  /** The submission that closes collection. */
  review: "review" as ComplianceScope,
  /** One message on the thread. */
  reply: "reply" as ComplianceScope,
  /** A plain re-read. Writes nothing, so nothing should block on it. */
  refresh: "refresh" as ComplianceScope,
  /**
   * One document row.
   *
   * Keyed by id where the row has one and by type where it does not, because
   * the first upload against a signed copy or the insurance certificate is what
   * creates the row it targets — there is no id to key on until it lands. The
   * id wins whenever both are supplied so that an upload and the approve that
   * follows it file under the same scope rather than two.
   */
  document: ({
    documentId,
    documentType,
  }: ComplianceDocumentTarget): ComplianceScope =>
    documentId ? `document:${documentId}` : `type:${documentType ?? "unknown"}`,
} as const;

/**
 * Every compliance mutation returns the whole engagement.
 *
 * The alternative — patching individual documents into the store — means the
 * reducer has to know which of a dozen server-side transitions just happened,
 * because approving the last document also moves the engagement's own status
 * and one write changes two things. Returning the engagement makes the store a
 * copy of the server's answer instead of a second opinion about it.
 */
async function replaceEngagement(
  projectId: string,
  path: string,
  init: RequestInit,
  fallbackMessage: string,
) {
  await fetchJson<unknown>(
    `/api/projects/${projectId}/compliance${path}`,
    init,
    fallbackMessage,
  );
  const refreshed = await fetchJson<CertifierEngagementDetail | null>(
    `/api/projects/${projectId}/compliance`,
    { method: "GET" },
    fallbackMessage,
  );
  return { projectId, engagement: refreshed.data };
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const startCertifierEngagement = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & StartEngagementInput,
  { rejectValue: string }
>("projects/startCertifierEngagement", async ({ projectId, ...payload }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "",
      jsonPost(payload),
      "Unable to start the certifier engagement",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to start the certifier engagement",
    );
  }
});

export const uploadComplianceDocument = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & ComplianceDocumentUploadInput,
  { rejectValue: string }
>("projects/uploadComplianceDocument", async ({ projectId, ...payload }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "/documents",
      jsonPost(payload),
      "Unable to attach the uploaded document",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to attach the uploaded document",
    );
  }
});

export const sendCertifierOutreach = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string },
  { rejectValue: string }
>("projects/sendCertifierOutreach", async ({ projectId }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "/outreach",
      { method: "POST" },
      "Unable to send the documents to the certifier",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to send the documents to the certifier",
    );
  }
});

export const sendCertifierReply = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & CertifierReplyInput,
  { rejectValue: string }
>("projects/sendCertifierReply", async ({ projectId, ...payload }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "/reply",
      jsonPost(payload),
      "Unable to send the reply",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to send the reply",
    );
  }
});

export const resolveComplianceDocument = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & ResolveComplianceDocumentInput,
  { rejectValue: string }
>("projects/resolveComplianceDocument", async ({ projectId, ...payload }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      `/documents/${payload.documentId}/resolve`,
      jsonPost(payload),
      "Unable to resolve the document",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to resolve the document",
    );
  }
});

/**
 * Marks a checklist line as not applying to this job, or puts it back.
 *
 * Filed under the same document scope as the upload and the resolve, so the row
 * is busy for this the way it is for those and an admin cannot start an upload
 * against a line they are halfway through waving off.
 */
export const setComplianceDocumentNotRequired = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & SetComplianceDocumentNotRequiredInput,
  { rejectValue: string }
>(
  "projects/setComplianceDocumentNotRequired",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        `/documents/${payload.documentId}/not-required`,
        jsonPost(payload),
        "Unable to update the document",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to update the document",
      );
    }
  },
);

export const sendSignedCopies = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string },
  { rejectValue: string }
>("projects/sendSignedCopies", async ({ projectId }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "/signed-copies",
      { method: "POST" },
      "Unable to send the signed copies",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to send the signed copies",
    );
  }
});

export const identifyComplianceDocument = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string; documentId: string } & ClassifyReceivedDocumentInput,
  { rejectValue: string }
>(
  "projects/identifyComplianceDocument",
  async ({ projectId, documentId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        `/documents/${documentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "Unable to identify the document",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to identify the document",
      );
    }
  },
);

export const sendComplianceForReview = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string },
  { rejectValue: string }
>("projects/sendComplianceForReview", async ({ projectId }, thunkApi) => {
  try {
    return await replaceEngagement(
      projectId,
      "/review",
      { method: "POST" },
      "Unable to send the file to the certifier",
    );
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to send the file to the certifier",
    );
  }
});

/**
 * Refreshes the engagement without mutating anything.
 *
 * Used after the discovery modal and the checklist workflow, both of which
 * write through their own routes and leave the store a version behind.
 */
export const refreshCertifierEngagement = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string },
  { rejectValue: string }
>("projects/refreshCertifierEngagement", async ({ projectId }, thunkApi) => {
  try {
    const response = await fetchJson<CertifierEngagementDetail | null>(
      `/api/projects/${projectId}/compliance`,
      { method: "GET" },
      "Unable to load the compliance file",
    );
    return { projectId, engagement: response.data };
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to load the compliance file",
    );
  }
});

/** What every compliance thunk resolves to: the engagement, wholesale. */
type ComplianceResult = {
  projectId: string;
  engagement: CertifierEngagementDetail | null;
};

/**
 * Pairs a compliance thunk with the scope its state is filed under.
 *
 * Written as a table rather than as a switch on `action.type` for the same
 * reason `isAnyOf` is preferred over a prefix check: a type string typed by
 * hand fails silently at runtime, whereas a scope function that cannot read the
 * thunk's own argument is a type error on this line. The scope is stored
 * accepting `never` so the table can hold nine differently-argued thunks — the
 * reducer only ever calls it with the argument that thunk was dispatched with.
 */
function complianceOperation<Arg extends { projectId: string }>(
  thunk: AsyncThunk<ComplianceResult, Arg, { rejectValue: string }>,
  scope: (arg: Arg) => ComplianceScope,
) {
  return { thunk, scope: scope as (arg: never) => ComplianceScope };
}

const complianceOperations = [
  complianceOperation(startCertifierEngagement, () => complianceScope.engagement),
  complianceOperation(uploadComplianceDocument, complianceScope.document),
  complianceOperation(sendCertifierOutreach, () => complianceScope.outreach),
  complianceOperation(sendCertifierReply, () => complianceScope.reply),
  complianceOperation(resolveComplianceDocument, complianceScope.document),
  complianceOperation(
    setComplianceDocumentNotRequired,
    complianceScope.document,
  ),
  complianceOperation(sendSignedCopies, () => complianceScope.signedCopies),
  complianceOperation(identifyComplianceDocument, complianceScope.document),
  complianceOperation(sendComplianceForReview, () => complianceScope.review),
  complianceOperation(refreshCertifierEngagement, () => complianceScope.refresh),
];

const complianceThunks = complianceOperations.map((operation) => operation.thunk);

const complianceScopeByTypePrefix = new Map(
  complianceOperations.map((operation) => [
    operation.thunk.typePrefix,
    operation.scope,
  ]),
);

/**
 * Which scope a compliance action belongs to.
 *
 * Falls back to the thunk's own prefix rather than throwing: an operation left
 * out of the table above still gets a stable key of its own, so the worst case
 * is a control that does not know it is busy — not a reducer that crashes
 * mid-write and leaves the engagement half-replaced.
 */
function complianceScopeOf(action: {
  type: string;
  meta: { arg: unknown };
}): ComplianceScope {
  const typePrefix = action.type.slice(0, action.type.lastIndexOf("/"));
  const scope = complianceScopeByTypePrefix.get(typePrefix);
  return scope ? scope(action.meta.arg as never) : typePrefix;
}

const isComplianceThunkPending = isAnyOf(
  ...complianceThunks.map((thunk) => thunk.pending),
);
const isComplianceThunkFulfilled = isAnyOf(
  ...complianceThunks.map((thunk) => thunk.fulfilled),
);
const isComplianceThunkRejected = isAnyOf(
  ...complianceThunks.map((thunk) => thunk.rejected),
);

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
      // Scopes are keyed by document id and type, neither of which means
      // anything on a different project. Carrying them across would leave a
      // row on the new project reading the outcome of a write to another one.
      if (state.activeProject?.id !== action.payload?.id) {
        state.complianceMutations = {};
      }
      state.activeProject = action.payload;
    },
    syncProjectFromDetail(state, action: PayloadAction<ProjectDetail>) {
      syncProjectState(state, action.payload);
    },
    appendFileToProject(state, action: PayloadAction<{ projectId: string; file: ProjectFiles }>) {
      if (state.activeProject?.id === action.payload.projectId) {
        state.activeProject.files.push(action.payload.file);
      }
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
    updateProjectTradieSchedule(state, action: PayloadAction<{ projectId: string; scheduleId: string; update: Partial<TradieScheduleWithTradieAndMilestone> }>) {
      if (state.activeProject?.id === action.payload.projectId) {
        const scheduleIndex = state.activeProject.tradieSchedules.findIndex((s) => s.id === action.payload.scheduleId);
        if (scheduleIndex !== -1) {
          state.activeProject.tradieSchedules[scheduleIndex] = {
            ...state.activeProject.tradieSchedules[scheduleIndex],
            ...action.payload.update,
          };
        }
      }
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
      state.complianceMutations = {};
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
          // `action.payload` is the structured failure from rejectWithValue;
          // `action.error.message` is only "Rejected" on that path, so it is
          // the fallback for an unexpected thrown error, not the source.
          error:
            action.payload?.message ??
            action.error.message ??
            "Unable to create project",
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
              lastQuotedPriceUnit: schedule.lastQuotedPriceUnit,
              createdAt: new Date(),
              updatedAt: new Date(),
              email: schedule.contact.email,
              phone: schedule.contact.phone,
              location: null,
              trade: schedule.tradeType,
              abn: schedule.abn,
              isFavourite: schedule.isFavourite,
              note: null,
              additionalEmails: schedule.contact.additionalEmails
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
                lastQuotedPriceUnit: schedule.lastQuotedPriceUnit,
                createdAt: new Date(),
                updatedAt: new Date(),
                email: schedule.contact.email,
                phone: schedule.contact.phone,
                trade: schedule.tradeType,
                location: null,
                abn: schedule.abn,
                isFavourite: schedule.isFavourite,
                note: null,
                additionalEmails: []
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
          const newMilestone = action.payload;
          const parentMilestone = newMilestone.parentId ? state.activeProject.milestones.find((m) => m.id === newMilestone.parentId) : null;

          if (parentMilestone?.status === "ACTIVE") {
            parentMilestone.status = "PENDING";
          }

          state.activeProject.milestones.forEach((milestone) => {
            if (milestone.order >= newMilestone.order) {
              milestone.order += 1;
            }
          });

          state.activeProject.milestones.push(newMilestone);

          // Optional, if consumers expect the array to be ordered.
          state.activeProject.milestones.sort((a, b) => a.order - b.order);

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
          const pendingMilestones = state.activeProject.milestones.filter((m) => m.status === "PENDING");
          if (pendingMilestones.length === 0 && state.activeProject.milestones.every((m) => ["DONE", "NOT_REQUIRED"].includes(m.status))) {
            state.activeProject.status = "COMPLETED";
          } else if (state.activeProject.status !== "ACTIVE") {
            state.activeProject.status = "ACTIVE";
          }
          if (milestoneIndex !== -1) {
            // Captured before the merge: a milestone can be updated more than
            // once while DONE (editing its target date, correcting the spend),
            // and adding the full amount each time inflated the project's
            // "Spent to date" by one milestone per edit. Apply the difference.
            const spendBeforeUpdate =
              Number(state.activeProject!.milestones[milestoneIndex].spend) || 0;

            state.activeProject!.milestones[milestoneIndex] = { ...state.activeProject!.milestones[milestoneIndex], ...action.payload };
            const parentId = state.activeProject!.milestones[milestoneIndex].parentId;
            if (action.payload.status === "DONE") {
              const spendAfterUpdate = Number(action.payload.spend) || 0;
              state.activeProject!.spent = (
                Number(state.activeProject!.spent) - spendBeforeUpdate + spendAfterUpdate
              ).toString();
            }
            if (parentId && (action.payload.status === "DONE" || action.payload.status === "NOT_REQUIRED")) {
              const allChildrenMilestonesNotCompleted = state.activeProject!.milestones.filter((m) => m.parentId === parentId && !["DONE", "NOT_REQUIRED"].includes(m.status));
              const allChildrenWereNotRequired = state.activeProject!.milestones.filter((m) => m.parentId === parentId && m.status === "NOT_REQUIRED");
              const allChildrenMilestone = state.activeProject!.milestones.filter((m) => m.parentId === parentId);
              if (allChildrenMilestonesNotCompleted.length === 0) {
                const parentIndex = state.activeProject!.milestones.findIndex((m) => m.id === parentId);
                const totalChildSpent = state.activeProject!.milestones.filter((m) => m.parentId === parentId).reduce((sum, m) => sum + (Number(m.spend) || 0), 0);
                if (parentIndex !== -1) {
                  state.activeProject!.milestones[parentIndex] = {
                    ...state.activeProject!.milestones[parentIndex],
                    status: allChildrenWereNotRequired.length === allChildrenMilestone.length ? "NOT_REQUIRED" : "DONE",
                    spend: totalChildSpent.toString(),
                    actualDate: action.payload.actualDate
                  };
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
      })
      // Compliance: every thunk lands the same way — the engagement replaced
      // wholesale — so they are registered through one matcher rather than
      // twenty-seven near-identical cases. What differs is where the status
      // goes: each request files under its own scope, so several can be in
      // flight at once without any of them speaking for the others.
      .addMatcher(isComplianceThunkPending, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "pending",
          error: null,
        };
      })
      .addMatcher(isComplianceThunkFulfilled, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "succeeded",
          error: null,
        };
        if (state.activeProject?.id === action.payload.projectId) {
          state.activeProject.certifierEngagement = action.payload.engagement;
        }
      })
      .addMatcher(isComplianceThunkRejected, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "failed",
          error:
            action.payload ??
            action.error.message ??
            "Unable to update the compliance file",
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
  appendFileToProject,
  updateProjectTradieSchedule,
} = projectsSlice.actions;

export const selectProjectsState = (state: RootState) => state.projects;

export const selectProjectDetailUiState = (projectId: string) =>
  createSelector(selectProjectsState, (projectsState) => {
    return projectsState.detailUi.byProjectId[projectId] ?? defaultDetailUiState;
  });

/** Shared so an untouched scope reads as one stable object, not a new one. */
const IDLE_MUTATION: ProjectMutationState = { status: "idle", error: null };

export const selectComplianceMutations = (state: RootState) =>
  state.projects.complianceMutations;

/**
 * One scope's state, `idle` where nothing has been dispatched against it.
 *
 * A plain selector factory rather than a memoised one: it returns a value
 * already in the store (or the shared idle object), so there is nothing to
 * memoise and it is safe to build fresh on every render.
 */
export const selectComplianceMutation =
  (scope: ComplianceScope) =>
  (state: RootState): ProjectMutationState =>
    state.projects.complianceMutations[scope] ?? IDLE_MUTATION;

/**
 * Whether any of the named scopes has a write in flight.
 *
 * Takes several because most controls depend on more than one: the review send
 * is blocked by its own request and by a write to anything it carries, and
 * offering it while a checklist item is still uploading would send a set the
 * admin is halfway through changing. Returns a boolean, so the factory can be
 * called inline without a re-render on every store change.
 */
export const selectIsCompliancePending =
  (...scopes: ComplianceScope[]) =>
  (state: RootState): boolean =>
    scopes.some(
      (scope) => state.projects.complianceMutations[scope]?.status === "pending",
    );

export const selectProjectUploadQueue = (projectId: string) =>
  createSelector(selectProjectsState, (projectsState) => projectsState.uploadsByProjectId[projectId] ?? {});

export const selectActiveProjectBudgetSummary = createSelector(selectProjectsState, (projectsState): BudgetSummary | null => {
  const project = projectsState.activeProject;

  if (!project) {
    return null;
  }

  const totalBudget = Number(project.totalBudget);
  const spent = Number(project.spent);
  // `variance` is the signed truth: negative when spend has exceeded the
  // contract value. `remaining` stays clamped at zero because it reads as
  // "budget still available to draw down", which can never be negative —
  // but clamping alone made an overrun unreachable for any consumer, so the
  // real figure is exposed alongside it rather than in place of it.
  const variance = totalBudget - spent;
  const remaining = Math.max(variance, 0);
  const spentPercent = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
  const status = getBudgetStatus(totalBudget, spent);

  return {
    totalBudget,
    spent,
    remaining,
    variance,
    spentPercent,
    status,
  };
});

export default projectsSlice.reducer;