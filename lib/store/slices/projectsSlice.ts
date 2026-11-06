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
  TradieScheduleListItem,
  type AddProjectUpdateRequest,
  type ProjectDetail,
  type ProjectMutationState,
  type ProjectUploadRecord,
  type ProjectWithStats,
  type MilestoneUpdateResult,
  type BudgetSummary,
  TradieScheduleWithTradieAndMilestone,
} from "@/types/project";
import { reviveMilestoneDates } from "@/lib/projects/milestone-dates";
import { reviveComplianceEngagementDates } from "@/lib/domain/compliance/engagement-dates";
import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { getBudgetStatus } from "@/lib/utils/project-budget-status";
// A value import, not a type one: `complianceScope.party` names the architect
// at runtime when the waste management request is filed under their thread.
import {
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  CompliancePartyType,
} from "@prisma/client";
import type { File as ProjectFiles } from "@prisma/client";
import { fetchJson } from "@/utils/fetch";
import type { CertifierEngagementDetail } from "@/types/compliance";
import type {
  CertifierReplyInput,
  ClassifyReceivedDocumentInput,
  ComplianceDocumentUploadInput,
  DeveloperDecisionInput,
  DeveloperRequirementInput,
  DeveloperResendInput,
  DevelopmentApplicationRequirementInput,
  PartyReplyInput,
  PartySelfSuppliedInput,
  EstateDeveloperRequest,
  ExternalApplicationRequest,
  PrincipalCertifierRequest,
  WasteManagementRequest,
  ResolveComplianceAlertInput,
  ResolveComplianceMeetingRequest,
  ResolveComplianceDocumentInput,
  ReviewArchitectPlansInput,
  ScheduleComplianceMeetingRequest,
  SetComplianceDocumentNotRequiredInput,
  StartEngagementInput,
  StartPartyOutreachInput,
} from "@/utils/validators/compliance";
import type { DeveloperApprovalDocument } from "@/constants/complianceDocuments";
import type {
  MilestoneCreationData,
  AddMaterialInput,
  MilestoneUpdateData,
  MilestonePictureUploadData,
  ProjectDetailTabKey,
  CreateTradieScheduleInput,
  ManualTradieQuoteFormInput,
  SendTradieRequestsFormInput,
} from "@/utils/validators";
import { createProjectWithLeadAction } from "@/lib/actions/projects";
import type { CreateProjectWithLeadInput } from "@/lib/data/projectsWrite";
import {
  toCreateProjectFailure,
  type CreateProjectFailure,
} from "@/lib/projects/create-project-errors";
import {
  recordManualTradieQuote,
  requestTradeCancellationForProject,
  retryTradieRequestEmailForProject,
  selectTradeQuoteForProject,
  sendTradieRequestsForProject,
} from "@/lib/data/tradie-requests";
import type { DomainActionFailure } from "@/lib/http/domain-response";
import { milestoneTargetDates } from "@/lib/domain/projects/milestone-schedule";

type MutationKey =
  | "createProject"
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
  developerPendingDocument: DeveloperApprovalDocument | null;
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
  developerPendingDocument: null,
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
    return thunkApi.rejectWithValue(
      error instanceof Error
        ? error.message
        : "Unable to add material to project",
    );
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
    return thunkApi.rejectWithValue(
      error instanceof Error ? error.message : "Unable to add site update",
    );
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
    "Failed to create tradie schedule",
  );

  return response.data;
});

/**
 * A Tradies-tab action that answers with the project as it now stands. The
 * store takes that project whole (see `isTradieTabActionFulfilled`) instead of
 * patching bookings in by hand, so the tab shows what the server committed.
 * A refusal comes back as a value: a thrown Server Action message is a digest
 * in production.
 */
function tradieTabAction<
  Arg,
  Result extends { ok: true; project: ProjectDetail },
>(
  type: string,
  action: (arg: Arg) => Promise<Result | DomainActionFailure>,
  fallback: string,
) {
  return createAsyncThunk<Result, Arg, { rejectValue: string }>(
    type,
    async (arg, thunkApi) => {
      try {
        const result = await action(arg);
        if (!result.ok) return thunkApi.rejectWithValue(result.error);
        return result;
      } catch (error) {
        return thunkApi.rejectWithValue(
          error instanceof Error ? error.message : fallback,
        );
      }
    },
  );
}

/**
 * Sends a tradie request (one trade, several activities, one or more
 * companies). A saved request whose email failed is still a success here: the
 * wizard reports the failed sends, and the tab keeps showing them with Retry.
 */
export const sendTradieRequests = tradieTabAction(
  "tradies/sendRequests",
  (payload: SendTradieRequestsFormInput) =>
    sendTradieRequestsForProject(payload),
  "Failed to send the request",
);

export const retryTradieRequestEmail = tradieTabAction(
  "tradies/retryRequestEmail",
  (payload: { projectId: string; recipientId: string }) =>
    retryTradieRequestEmailForProject(payload),
  "Failed to retry the email",
);

export const recordManualQuote = tradieTabAction(
  "tradies/recordManualQuote",
  (payload: ManualTradieQuoteFormInput) => recordManualTradieQuote(payload),
  "Failed to record the quote",
);

export const selectTradeQuote = tradieTabAction(
  "tradies/selectTradeQuote",
  (payload: { projectId: string; tradieId: string; trade?: string }) =>
    selectTradeQuoteForProject(payload),
  "Failed to select the quote",
);

export const requestTradeCancellation = tradieTabAction(
  "tradies/requestTradeCancellation",
  (payload: { projectId: string; selectionId: string; reason: string }) =>
    requestTradeCancellationForProject(payload),
  "Failed to request the cancellation",
);

const isTradieTabActionFulfilled = isAnyOf(
  sendTradieRequests.fulfilled,
  retryTradieRequestEmail.fulfilled,
  recordManualQuote.fulfilled,
  selectTradeQuote.fulfilled,
  requestTradeCancellation.fulfilled,
);

/** Dismisses tradie follow-up alerts until their bookings change status. */
export const dismissTradieAlerts = createAsyncThunk<
  { dismissed: string[] },
  { projectId: string; scheduleIds: string[] },
  { rejectValue: string }
>(
  "projects/dismissTradieAlerts",
  async ({ projectId, scheduleIds }, thunkApi) => {
    try {
      const response = await fetchJson<{ dismissed: string[] }>(
        `/api/projects/${projectId}/tradie-alerts/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduleIds }),
        },
        "Unable to dismiss the alerts",
      );
      return response.data;
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to dismiss the alerts",
      );
    }
  },
);

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

    return reviveMilestoneDates(response.data);
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error
        ? error.message
        : "Unable to add milestone to project",
    );
  }
});

export const updateProjectMilestoneStatus = createAsyncThunk<
  MilestoneUpdateResult,
  MilestoneUpdateData & { projectId: string; milestoneId: string },
  { rejectValue: string }
>(
  "projects/updateMilestoneStatus",
  async ({ projectId, milestoneId, ...payload }, thunkApi) => {
    try {
      const response = await fetchJson<MilestoneUpdateResult>(
        `/api/projects/${projectId}/milestones/${milestoneId}/updates`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "Unable to update milestone",
      );

      // JSON has no date type, so every date on this response is an ISO string
      // while `SafeMilestone` still calls it a `Date`. Revive here, at the one
      // point the two representations meet, so the store keeps a single shape.
      return reviveMilestoneDates(response.data);
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to update milestone",
      );
    }
  },
);

export const addMilestonePhotos = createAsyncThunk<
  { id: string; projectId: string; files: ProjectFiles[] },
  MilestonePictureUploadData & { projectId: string; milestoneId: string },
  { rejectValue: string }
>(
  "projects/addMilestonePhotos",
  async ({ projectId, milestoneId, ...payload }, thunkApi) => {
    try {
      const response = await fetchJson<{
        id: string;
        projectId: string;
        files: ProjectFiles[];
      }>(
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
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to add photos to milestone",
      );
    }
  },
);

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
  /** Ticked checklist rows going over early, as one email. */
  earlyReview: "early-review" as ComplianceScope,
  /** One message on the thread. */
  reply: "reply" as ComplianceScope,
  /** A plain re-read. Writes nothing, so nothing should block on it. */
  refresh: "refresh" as ComplianceScope,
  /**
   * One party's engagement — the outreach that opens it, or the note that the
   * client supplied their documents instead.
   *
   * Keyed by party rather than shared, because the three sections are on screen
   * together: engaging a surveyor must not freeze the architect panel beside
   * it, and the two writes cannot collide anyway.
   */
  party: (party: CompliancePartyType): ComplianceScope => `party:${party}`,
  /** One message on one party's thread. */
  partyReply: (outreachId: string): ComplianceScope =>
    `party-reply:${outreachId}`,
  /** Closing one alert. */
  alert: (alertId: string): ComplianceScope => `alert:${alertId}`,
  /**
   * One application block's own state — the question, the lodgement, the tick.
   *
   * Its own scope rather than `party(COUNCIL)`, because that key covers
   * engaging a party and there is nobody to engage here. Keeping them apart
   * means the certificate upload, which files under the document scope, and
   * the answer, which files under this one, do not freeze each other.
   *
   * Keyed by kind rather than shared across all five, for the same reason the
   * party scope is keyed by party: the road opening permit and the long service
   * levy sit on the same list, and recording a lodgement on one must not grey
   * out the other.
   */
  application: (kind: ComplianceExternalApplicationKind): ComplianceScope =>
    `application:${kind}`,
  /**
   * Recording the principal certifier appointment.
   *
   * Its own scope rather than the certificate application's, though the two sit
   * in the same block and the appointment gates the lodgement. They are on screen
   * together, which is the whole test this table applies: an admin filling in the
   * appointment form must not grey out the lodgement form underneath it, since the
   * ordinary sitting is to submit both in a row.
   */
  principalCertifier: "principal-certifier" as ComplianceScope,
  /**
   * Everything on the estate developer's block.
   *
   * One scope for three writes — the verdict, the re-send, and whether the
   * approval is needed at all — rather than three, because unlike the party
   * sections these controls are never on screen together. The block renders one
   * step at a time, so a shared key freezes exactly the control that is showing
   * and nothing else.
   */
  developer: "developer" as ComplianceScope,
  /** Booking, moving or resolving the client and architect meeting. */
  meeting: "meeting" as ComplianceScope,
  /** Recording the client's verdict on the preliminary plans. */
  planReview: "plan-review" as ComplianceScope,
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
  return {
    projectId,
    engagement: reviveComplianceEngagementDates(refreshed.data),
  };
}

const jsonPost = (body: unknown, idempotencyKey?: string): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...idempotencyHeader(idempotencyKey),
  },
  body: JSON.stringify(body),
});

export const startCertifierEngagement = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & StartEngagementInput,
  { rejectValue: string }
>(
  "projects/startCertifierEngagement",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "",
        jsonPost(payload),
        "Unable to start the certifier engagement",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to start the certifier engagement",
      );
    }
  },
);

export const uploadComplianceDocument = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & ComplianceDocumentUploadInput,
  { rejectValue: string }
>(
  "projects/uploadComplianceDocument",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/documents",
        jsonPost(payload),
        "Unable to attach the uploaded document",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to attach the uploaded document",
      );
    }
  },
);

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
      error instanceof Error
        ? error.message
        : "Unable to send the documents to the certifier",
    );
  }
});

export const sendCertifierReply = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & CertifierReplyInput,
  { rejectValue: string }
>(
  "projects/sendCertifierReply",
  async ({ projectId, ...payload }, thunkApi) => {
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
  },
);

export const resolveComplianceDocument = createAsyncThunk<
  { projectId: string; engagement: CertifierEngagementDetail | null },
  { projectId: string } & ResolveComplianceDocumentInput,
  { rejectValue: string }
>(
  "projects/resolveComplianceDocument",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        `/documents/${payload.documentId}/resolve`,
        jsonPost(payload),
        "Unable to resolve the document",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to resolve the document",
      );
    }
  },
);

/**
 * Sends the ticked checklist rows to the certifier in one email, without
 * waiting for the rest of the pack.
 *
 * Returns how many went and how many the certifier already had, so the tab can
 * say which — "sent" for a set that was already on the thread would tell the
 * office an email went out when none did.
 */
export const sendComplianceDocumentsForReview = createAsyncThunk<
  {
    projectId: string;
    engagement: CertifierEngagementDetail | null;
    sentCount: number;
    alreadySentCount: number;
  },
  { projectId: string; documentIds: string[] },
  { rejectValue: string }
>(
  "projects/sendComplianceDocumentsForReview",
  async ({ projectId, documentIds }, thunkApi) => {
    const fallback = "Unable to send the documents for verification";
    try {
      const sent = await fetchJson<{
        sentCount: number;
        alreadySentCount: number;
      }>(
        `/api/projects/${projectId}/compliance/early-review`,
        jsonPost({ documentIds }),
        fallback,
      );
      const refreshed = await fetchJson<CertifierEngagementDetail | null>(
        `/api/projects/${projectId}/compliance`,
        { method: "GET" },
        fallback,
      );
      return {
        projectId,
        engagement: reviveComplianceEngagementDates(refreshed.data),
        sentCount: sent.data.sentCount,
        alreadySentCount: sent.data.alreadySentCount,
      };
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : fallback,
      );
    }
  },
);

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
        error instanceof Error
          ? error.message
          : "Unable to update the document",
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
      error instanceof Error
        ? error.message
        : "Unable to send the signed copies",
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
        error instanceof Error
          ? error.message
          : "Unable to identify the document",
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
      error instanceof Error
        ? error.message
        : "Unable to send the file to the certifier",
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
    return {
      projectId,
      engagement: reviveComplianceEngagementDates(response.data),
    };
  } catch (error) {
    return thunkApi.rejectWithValue(
      error instanceof Error
        ? error.message
        : "Unable to load the compliance file",
    );
  }
});

// ---------------------------------------------------------------------------
// The other parties on the compliance file
// ---------------------------------------------------------------------------

/**
 * Engages a surveyor or an architect, and sends their opening email.
 *
 * `mode` rides in the body rather than in the path: the route is one decision
 * made at one moment from one panel — write to a surveyor, or record that the
 * client brought their own survey — and two endpoints that must never both
 * succeed on the same file is a race with nothing but ordering to stop it.
 */
export const startPartyOutreach = createAsyncThunk<
  ComplianceResult,
  { projectId: string; idempotencyKey?: string } & StartPartyOutreachInput,
  { rejectValue: string }
>(
  "projects/startPartyOutreach",
  async ({ projectId, idempotencyKey, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/parties",
        jsonPost({ mode: "OUTREACH", ...payload }, idempotencyKey),
        "Unable to engage this party",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to engage this party",
      );
    }
  },
);

/**
 * Records the estate developer's answer on the bushfire report.
 *
 * A rejection carries the reasons through to the bushfire consultant server
 * side, so this one dispatch is the whole of the loop from the client's point
 * of view — there is no second call to make and nothing for the tab to remember
 * to do.
 */
export const recordDeveloperDecision = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & DeveloperDecisionInput,
  { rejectValue: string }
>(
  "projects/recordDeveloperDecision",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/developer/decision",
        jsonPost(payload),
        "Unable to record the developer's decision",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record the developer's decision",
      );
    }
  },
);

/** Puts the revised bushfire report back in front of the developer. */
export const resendDeveloperApproval = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & DeveloperResendInput,
  { rejectValue: string }
>(
  "projects/resendDeveloperApproval",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/developer/resend",
        jsonPost(payload),
        "Unable to send the report back to the developer",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to send the report back to the developer",
      );
    }
  },
);

/** Records whether this lot needs the estate developer's approval at all. */
export const setDeveloperApprovalRequired = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & DeveloperRequirementInput,
  { rejectValue: string }
>(
  "projects/setDeveloperApprovalRequired",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/developer/requirement",
        jsonPost(payload),
        "Unable to record whether a developer approval is needed",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record whether a developer approval is needed",
      );
    }
  },
);

/**
 * Records whether this lot is in an estate, and who the developer is.
 *
 * The banner's own write, and a superset of `setDeveloperApprovalRequired` above.
 * Both exist because the question is asked in two places: the bare yes/no on the
 * development application block, where the address is not to hand, and the whole
 * thing on the banner at the top of the tab, where it is.
 *
 * Filed under the developer scope with the other three, which is the right trade
 * here for the reason that scope is shared: the banner and the developer block are
 * never on screen at the same moment.
 */
export const setEstateDeveloper = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & EstateDeveloperRequest,
  { rejectValue: string }
>(
  "projects/setEstateDeveloper",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/developer/estate",
        jsonPost(payload),
        "Unable to record the estate developer",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record the estate developer",
      );
    }
  },
);

/** Records whether this compliance file needs a Development Application. */
export const setDevelopmentApplicationRequired = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & DevelopmentApplicationRequirementInput,
  { rejectValue: string }
>(
  "projects/setDevelopmentApplicationRequired",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/development-application/requirement",
        jsonPost(payload),
        "Unable to record whether a Development Application is needed",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record whether a Development Application is needed",
      );
    }
  },
);

/** Records that the client already had this party's documents. */
export const recordPartySelfSupplied = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & PartySelfSuppliedInput,
  { rejectValue: string }
>(
  "projects/recordPartySelfSupplied",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/parties",
        jsonPost({ mode: "SELF_SUPPLIED", ...payload }),
        "Unable to record these as client supplied",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record these as client supplied",
      );
    }
  },
);

/** One message on one party's thread. */
export const sendPartyReply = createAsyncThunk<
  ComplianceResult,
  { projectId: string; idempotencyKey?: string } & PartyReplyInput,
  { rejectValue: string }
>(
  "projects/sendPartyReply",
  async ({ projectId, idempotencyKey, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/parties/reply",
        jsonPost(payload, idempotencyKey),
        "Unable to send the message",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to send the message",
      );
    }
  },
);

/**
 * Records where one application to an outside body has got to.
 *
 * Filed under a scope of its own rather than under the council party, because
 * the council has no outreach to be busy on and the two things a block does —
 * answering the question and uploading the document — are separate writes that
 * must not freeze each other.
 */
export const recordExternalApplication = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & ExternalApplicationRequest,
  { rejectValue: string }
>(
  "projects/recordExternalApplication",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/applications",
        jsonPost(payload),
        "Unable to record the application",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record the application",
      );
    }
  },
);

/**
 * Records the certifier's appointment as principal certifier.
 *
 * Its own thunk rather than a step on `recordExternalApplication`, because it
 * writes to the engagement rather than to an application row: one appointment per
 * job, not one per lodgement. See `principalCertifierSchema`.
 */
export const recordPrincipalCertifier = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & PrincipalCertifierRequest,
  { rejectValue: string }
>(
  "projects/recordPrincipalCertifier",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/principal-certifier",
        jsonPost(payload),
        "Unable to record the appointment",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record the appointment",
      );
    }
  },
);

/**
 * Asks the architect for the waste management plan.
 *
 * Filed under the architect's party scope rather than a scope of its own,
 * because it is a send on their thread: the same thread the connect control
 * and the meeting invitation write to, and two of those in flight at once is
 * two messages nobody meant to send.
 */
export const requestWasteManagementPlan = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & WasteManagementRequest,
  { rejectValue: string }
>(
  "projects/requestWasteManagementPlan",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/architect/waste-management",
        jsonPost(payload),
        "Unable to send the request",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to send the request",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// The architect's workflow beyond their two documents
// ---------------------------------------------------------------------------

/** Books the client and architect in, and mails them both. */
export const scheduleClientMeeting = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & ScheduleComplianceMeetingRequest,
  { rejectValue: string }
>(
  "projects/scheduleClientMeeting",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/architect/meeting",
        jsonPost(payload),
        "Unable to schedule the meeting",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to schedule the meeting",
      );
    }
  },
);

/** Records that the meeting happened, or moves it. */
export const resolveClientMeeting = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & ResolveComplianceMeetingRequest,
  { rejectValue: string }
>(
  "projects/resolveClientMeeting",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/architect/meeting",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "Unable to update the meeting",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to update the meeting",
      );
    }
  },
);

/** Records whether the client signed off on the preliminary plans. */
export const reviewArchitectPlans = createAsyncThunk<
  ComplianceResult,
  { projectId: string } & ReviewArchitectPlansInput,
  { rejectValue: string }
>(
  "projects/reviewArchitectPlans",
  async ({ projectId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        "/architect/plan-review",
        jsonPost(payload),
        "Unable to record the client's answer",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error
          ? error.message
          : "Unable to record the client's answer",
      );
    }
  },
);

/** Closes an alert, with the note that says what closed it. */
export const resolveComplianceAlert = createAsyncThunk<
  ComplianceResult,
  { projectId: string; alertId: string } & ResolveComplianceAlertInput,
  { rejectValue: string }
>(
  "projects/resolveComplianceAlert",
  async ({ projectId, alertId, ...payload }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        `/alerts/${alertId}`,
        jsonPost(payload),
        "Unable to resolve the alert",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to resolve the alert",
      );
    }
  },
);

/**
 * Chases whoever an open alert is waiting on.
 *
 * Filed under the alert's own scope, like the resolve: the two are the pair of
 * things you can do to one alert, and a chase in flight has to disable the
 * resolve beside it.
 *
 * Was `requestUpdatedTitleSearch`, which chased the one party the one alert
 * type of the day was about. The server now holds the table of which party each
 * condition belongs to, so the client only has to name the alert.
 */
export const sendComplianceFollowUp = createAsyncThunk<
  ComplianceResult,
  { projectId: string; alertId: string; idempotencyKey?: string },
  { rejectValue: string }
>(
  "projects/sendComplianceFollowUp",
  async ({ projectId, alertId, idempotencyKey }, thunkApi) => {
    try {
      return await replaceEngagement(
        projectId,
        `/alerts/${alertId}/follow-up`,
        { method: "POST", headers: idempotencyHeader(idempotencyKey) },
        "Unable to send the follow-up",
      );
    } catch (error) {
      return thunkApi.rejectWithValue(
        error instanceof Error ? error.message : "Unable to send the follow-up",
      );
    }
  },
);

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
function complianceOperation<
  Arg extends { projectId: string },
  Result extends ComplianceResult = ComplianceResult,
>(
  thunk: AsyncThunk<Result, Arg, { rejectValue: string }>,
  scope: (arg: Arg) => ComplianceScope,
) {
  // A thunk may answer with more than the engagement — the early send also
  // says how many documents went — but the table only ever reads the
  // engagement, which every one of them carries.
  return {
    thunk: thunk as unknown as AsyncThunk<
      ComplianceResult,
      Arg,
      { rejectValue: string }
    >,
    scope: scope as (arg: never) => ComplianceScope,
  };
}

const complianceOperations = [
  complianceOperation(
    startCertifierEngagement,
    () => complianceScope.engagement,
  ),
  complianceOperation(uploadComplianceDocument, complianceScope.document),
  complianceOperation(sendCertifierOutreach, () => complianceScope.outreach),
  complianceOperation(sendCertifierReply, () => complianceScope.reply),
  complianceOperation(resolveComplianceDocument, complianceScope.document),
  complianceOperation(
    sendComplianceDocumentsForReview,
    () => complianceScope.earlyReview,
  ),
  complianceOperation(
    setComplianceDocumentNotRequired,
    complianceScope.document,
  ),
  complianceOperation(sendSignedCopies, () => complianceScope.signedCopies),
  complianceOperation(identifyComplianceDocument, complianceScope.document),
  complianceOperation(sendComplianceForReview, () => complianceScope.review),
  complianceOperation(
    refreshCertifierEngagement,
    () => complianceScope.refresh,
  ),
  complianceOperation(startPartyOutreach, (arg) =>
    complianceScope.party(arg.party),
  ),
  complianceOperation(recordPartySelfSupplied, (arg) =>
    complianceScope.party(arg.party),
  ),
  complianceOperation(sendPartyReply, (arg) =>
    complianceScope.partyReply(arg.outreachId),
  ),
  complianceOperation(recordDeveloperDecision, () => complianceScope.developer),
  complianceOperation(resendDeveloperApproval, () => complianceScope.developer),
  complianceOperation(
    setDeveloperApprovalRequired,
    () => complianceScope.developer,
  ),
  complianceOperation(setEstateDeveloper, () => complianceScope.developer),
  complianceOperation(setDevelopmentApplicationRequired, () =>
    complianceScope.application(
      ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
    ),
  ),
  complianceOperation(recordExternalApplication, (arg) =>
    complianceScope.application(arg.kind),
  ),
  complianceOperation(
    recordPrincipalCertifier,
    () => complianceScope.principalCertifier,
  ),
  complianceOperation(requestWasteManagementPlan, () =>
    complianceScope.party(CompliancePartyType.ARCHITECT),
  ),
  complianceOperation(scheduleClientMeeting, () => complianceScope.meeting),
  complianceOperation(resolveClientMeeting, () => complianceScope.meeting),
  complianceOperation(reviewArchitectPlans, () => complianceScope.planReview),
  complianceOperation(resolveComplianceAlert, (arg) =>
    complianceScope.alert(arg.alertId),
  ),
  complianceOperation(sendComplianceFollowUp, (arg) =>
    complianceScope.alert(arg.alertId),
  ),
];

const complianceThunks = complianceOperations.map(
  (operation) => operation.thunk,
);

const developerApprovalThunks = [
  recordDeveloperDecision,
  resendDeveloperApproval,
] as const;

const isDeveloperApprovalPending = isAnyOf(
  ...developerApprovalThunks.map((thunk) => thunk.pending),
);
const isDeveloperApprovalFinished = isAnyOf(
  ...developerApprovalThunks.map((thunk) => thunk.fulfilled),
  ...developerApprovalThunks.map((thunk) => thunk.rejected),
);

function developerDocumentOf(action: {
  meta: { arg: unknown };
}): DeveloperApprovalDocument {
  const documentType = (
    action.meta.arg as { documentType?: DeveloperApprovalDocument }
  ).documentType;
  return documentType ?? ComplianceDocumentType.BUSHFIRE_REPORT;
}

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

/**
 * The store's copy of what `updateMilestone` does when the first activity
 * starts: the project's start date becomes that day and every activity is
 * re-dated from it, by the same `milestoneTargetDates` the server used.
 */
function startScheduleInStore(project: ProjectDetail, startDate: Date) {
  if (new Date(project.startDate).getTime() === startDate.getTime()) return;

  project.startDate = startDate;
  const targetById = new Map<string, Date>();
  const ordered = [...project.milestones].sort((a, b) => a.order - b.order);
  const targets = milestoneTargetDates(startDate, ordered);
  ordered.forEach((milestone, position) => {
    milestone.targetDate = targets[position];
    targetById.set(milestone.id, milestone.targetDate);
  });
  for (const schedule of project.tradieSchedules) {
    const targetDate = schedule.milestoneId
      ? targetById.get(schedule.milestoneId)
      : undefined;
    if (schedule.milestone && targetDate) {
      schedule.milestone.targetDate = targetDate;
    }
  }
}

const projectsSlice = createSlice({
  name: "projects",
  initialState,
  reducers: {
    addOptimisticUpdate(
      state,
      action: PayloadAction<{
        projectId: string;
        update: Partial<Record<string, unknown>>;
      }>,
    ) {
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
        state.developerPendingDocument = null;
      }
      // The project arrives here two ways: from the server component, with real
      // Dates, and from a PATCH of `/api/projects/:id` -- the Overview tab's
      // save and the insurance-claim-dates modal both hand the whole JSON
      // project straight to this action. Through JSON every timestamp is a
      // string, and the engagement is the part of the payload that is read as
      // a Date rather than reformatted: `complianceStageFlow` measures an
      // outreach's `sentAt` in Sydney business days, and `Intl` throws
      // `RangeError: Invalid time value` on a string, which took the whole
      // project page down as soon as the Compliance tab rendered after a save.
      // Same normalization the milestone and compliance thunks already do on
      // their own responses, and a no-op on the Date-carrying payload. The
      // milestones travel on that PATCH too, and carry the exposure
      // `reviveMilestoneDates` was written for -- this action is the seed its
      // header names.
      state.activeProject = action.payload
        ? {
            ...action.payload,
            milestones: action.payload.milestones.map(reviveMilestoneDates),
            certifierEngagement: reviveComplianceEngagementDates(
              action.payload.certifierEngagement,
            ),
          }
        : null;
    },
    syncProjectFromDetail(state, action: PayloadAction<ProjectDetail>) {
      syncProjectState(state, action.payload);
    },
    appendFileToProject(
      state,
      action: PayloadAction<{ projectId: string; file: ProjectFiles }>,
    ) {
      if (state.activeProject?.id === action.payload.projectId) {
        state.activeProject.files.push(action.payload.file);
      }
    },
    removeFileFromProject(
      state,
      action: PayloadAction<{ projectId: string; fileId: string; url: string }>,
    ) {
      const project = state.activeProject;
      if (!project || project.id !== action.payload.projectId) return;
      project.files = project.files.filter(
        (file) => file.id !== action.payload.fileId,
      );
      project.documents = project.documents.filter(
        (document) => document.fileId !== action.payload.fileId,
      );
      for (const update of project.siteUpdates) {
        update.photoUrls = update.photoUrls.filter(
          (url) => url !== action.payload.url,
        );
      }
      for (const milestone of project.milestones) {
        milestone.files = milestone.files.filter(
          (file) => file.id !== action.payload.fileId,
        );
        for (const update of milestone.siteUpdates) {
          update.photoUrls = update.photoUrls.filter(
            (url) => url !== action.payload.url,
          );
        }
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
      const projectUploads =
        state.uploadsByProjectId[action.payload.projectId] ?? {};

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
      const upload =
        state.uploadsByProjectId[action.payload.projectId]?.[
          action.payload.fileId
        ];

      if (!upload) {
        return;
      }

      upload.status = "uploading";
      upload.progress = Math.max(
        0,
        Math.min(100, Math.round(action.payload.progress)),
      );
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
      const upload =
        state.uploadsByProjectId[action.payload.projectId]?.[
          action.payload.fileId
        ];

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
      const upload =
        state.uploadsByProjectId[action.payload.projectId]?.[
          action.payload.fileId
        ];

      if (!upload) {
        return;
      }

      upload.status = "failed";
      upload.error = action.payload.error;
    },
    clearProjectUploads(state, action: PayloadAction<string>) {
      delete state.uploadsByProjectId[action.payload];
    },
    setProjectDetailTab(
      state,
      action: PayloadAction<{ projectId: string; tab: ProjectDetailTabKey }>,
    ) {
      const current =
        state.detailUi.byProjectId[action.payload.projectId]
        ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        activeTab: action.payload.tab,
      };
    },
    setProjectDetailActivityFilter(
      state,
      action: PayloadAction<{
        projectId: string;
        filter: "all" | "site-updates" | "milestones";
      }>,
    ) {
      const current =
        state.detailUi.byProjectId[action.payload.projectId]
        ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        activityFilter: action.payload.filter,
      };
    },
    setProjectDetailChartRange(
      state,
      action: PayloadAction<{
        projectId: string;
        range: "monthly" | "quarterly";
      }>,
    ) {
      const current =
        state.detailUi.byProjectId[action.payload.projectId]
        ?? defaultDetailUiState;
      state.detailUi.byProjectId[action.payload.projectId] = {
        ...current,
        chartRange: action.payload.range,
      };
    },
    updateProjectTradieSchedule(
      state,
      action: PayloadAction<{
        projectId: string;
        scheduleId: string;
        update: Partial<TradieScheduleWithTradieAndMilestone>;
      }>,
    ) {
      if (state.activeProject?.id === action.payload.projectId) {
        const scheduleIndex = state.activeProject.tradieSchedules.findIndex(
          (s) => s.id === action.payload.scheduleId,
        );
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
        state.developerPendingDocument = null;
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
      state.developerPendingDocument = null;
      state.uploadsByProjectId = {};
      state.detailUi.byProjectId = {};
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
          // `action.payload` is the structured failure from rejectWithValue;
          // `action.error.message` is only "Rejected" on that path, so it is
          // the fallback for an unexpected thrown error, not the source.
          error:
            action.payload?.message
            ?? action.error.message
            ?? "Unable to create project",
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
        state.mutations.createTradieSchedule = {
          status: "pending",
          error: null,
        };
      })
      .addCase(createTradieScheduleForProject.fulfilled, (state, action) => {
        state.mutations.createTradieSchedule = {
          status: "succeeded",
          error: null,
        };
        const schedule = action.payload;
        const milestone = state.activeProject?.milestones.find(
          (m) => m.id === schedule.milestoneId,
        );
        if (state.activeProject?.id === schedule.projectId) {
          state.activeProject.tradieSchedules.push({
            id: schedule.id,
            status: schedule.status,
            alertDismissedStatus: null,
            alertDismissedAt: null,
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
              archivedAt: null,
              trade: schedule.tradeType,
              trades: [schedule.tradeType],
              abn: schedule.abn,
              isFavourite: schedule.isFavourite,
              note: null,
              additionalEmails: schedule.contact.additionalEmails,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            projectId: schedule.projectId,
            milestoneId: schedule.milestoneId ?? null,
            reminderSentAt: schedule.reminderSentAt
              ? new Date(schedule.reminderSentAt)
              : null,
            milestone: milestone,
            requiresQuote: schedule.requiresQuote,
            quotedPrice: schedule.quotedPrice ?? null,
            requestRecipientId: null,
            quoteId: null,
            refToken: schedule.refToken ?? null,
            trade: schedule.tradeType,
          });
        }
      })
      .addCase(createTradieScheduleForProject.rejected, (state, action) => {
        state.mutations.createTradieSchedule = {
          status: "failed",
          error:
            (action.payload as string | null)
            ?? action.error.message
            ?? "Failed to create tradie schedule",
        };
      })
      .addCase(sendTradieRequests.pending, (state) => {
        state.mutations.createTradieSchedule = {
          status: "pending",
          error: null,
        };
      })
      .addCase(sendTradieRequests.fulfilled, (state) => {
        state.mutations.createTradieSchedule = {
          status: "succeeded",
          error: null,
        };
      })
      .addCase(sendTradieRequests.rejected, (state, action) => {
        state.mutations.createTradieSchedule = {
          status: "failed",
          error:
            (action.payload as string | null)
            ?? action.error.message
            ?? "Failed to create tradie schedules",
        };
      })
      .addCase(addProjectMilestone.pending, (state) => {
        state.mutations.addMilestone = { status: "pending", error: null };
      })
      .addCase(addProjectMilestone.fulfilled, (state, action) => {
        state.mutations.addMilestone = { status: "succeeded", error: null };

        if (state.activeProject?.id === action.payload.projectId) {
          const newMilestone = action.payload;
          const parentMilestone = newMilestone.parentId
            ? state.activeProject.milestones.find(
                (m) => m.id === newMilestone.parentId,
              )
            : null;

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
          error:
            action.payload
            ?? action.error.message
            ?? "Unable to add milestone to project",
        };
      })
      .addCase(updateProjectMilestoneStatus.pending, (state) => {
        state.mutations.updateMilestone = { status: "pending", error: null };
      })
      .addCase(updateProjectMilestoneStatus.fulfilled, (state, action) => {
        state.mutations.updateMilestone = { status: "succeeded", error: null };
        const project = state.activeProject;
        if (project?.id !== action.payload.projectId) return;
        const { effects, ...milestone } = action.payload;
        const index = project.milestones.findIndex(
          (row) => row.id === milestone.id,
        );
        if (index !== -1)
          project.milestones[index] = {
            ...project.milestones[index],
            ...milestone,
          };
        for (const parent of effects.parents) {
          const row = project.milestones.find(
            (candidate) => candidate.id === parent.id,
          );
          if (!row) continue;
          row.status = parent.status;
          if (parent.spend !== undefined) row.spend = parent.spend;
          if (parent.startDate) row.startDate = new Date(parent.startDate);
          if (parent.actualDate) row.actualDate = new Date(parent.actualDate);
        }
        project.spent = effects.projectSpent;
        if (effects.projectStatus) project.status = effects.projectStatus;
        if (effects.projectStartDate)
          startScheduleInStore(project, new Date(effects.projectStartDate));
        const completed = new Set(effects.settledBookings.completed);
        const cancelled = new Set(effects.settledBookings.cancelled);
        const statusById = new Map(
          project.milestones.map((row) => [row.id, row.status]),
        );
        for (const schedule of project.tradieSchedules) {
          if (completed.has(schedule.id)) schedule.status = "COMPLETED";
          if (cancelled.has(schedule.id)) schedule.status = "CANCELLED";
          const status = schedule.milestoneId
            ? statusById.get(schedule.milestoneId)
            : undefined;
          if (schedule.milestone && status) schedule.milestone.status = status;
        }
        for (const row of project.milestones) {
          for (const schedule of row.tradieSchedules) {
            if (completed.has(schedule.id)) schedule.status = "COMPLETED";
            if (cancelled.has(schedule.id)) schedule.status = "CANCELLED";
          }
        }
      })
      .addCase(dismissTradieAlerts.fulfilled, (state, action) => {
        if (state.activeProject?.id !== action.meta.arg.projectId) return;
        const dismissed = new Set(action.payload.dismissed);
        const now = new Date();
        for (const schedule of state.activeProject.tradieSchedules) {
          if (!dismissed.has(schedule.id)) continue;
          schedule.alertDismissedStatus = schedule.status;
          schedule.alertDismissedAt = now;
        }
      })
      .addCase(updateProjectMilestoneStatus.rejected, (state, action) => {
        state.mutations.updateMilestone = {
          status: "failed",
          error:
            action.payload
            ?? action.error.message
            ?? "Unable to update milestone status",
        };
      })
      .addCase(addMilestonePhotos.pending, (state) => {
        state.mutations.addMilestonePhotos = { status: "pending", error: null };
      })
      .addCase(addMilestonePhotos.fulfilled, (state, action) => {
        state.mutations.addMilestonePhotos = {
          status: "succeeded",
          error: null,
        };
        if (state.activeProject?.id === action.payload.projectId) {
          const milestone = state.activeProject.milestones.find(
            (m) => m.id === action.payload.id,
          );
          if (milestone) {
            milestone.files.push(...action.payload.files);
          }
          state.activeProject.files.push(...action.payload.files);
        }
      })
      .addCase(addMilestonePhotos.rejected, (state, action) => {
        state.mutations.addMilestonePhotos = {
          status: "failed",
          error:
            action.payload
            ?? action.error.message
            ?? "Unable to add photos to milestone",
        };
      })
      // Compliance: every thunk lands the same way — the engagement replaced
      // wholesale — so they are registered through one matcher rather than
      // twenty-seven near-identical cases. What differs is where the status
      // goes: each request files under its own scope, so several can be in
      // flight at once without any of them speaking for the others.
      .addMatcher(isTradieTabActionFulfilled, (state, action) => {
        const project = action.payload.project;
        if (state.activeProject?.id !== project.id) return;
        state.activeProject = {
          ...project,
          milestones: project.milestones.map(reviveMilestoneDates),
          certifierEngagement: reviveComplianceEngagementDates(
            project.certifierEngagement,
          ),
        };
      })
      .addMatcher(isComplianceThunkPending, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "pending",
          error: null,
        };
      })
      .addMatcher(isDeveloperApprovalPending, (state, action) => {
        state.developerPendingDocument = developerDocumentOf(action);
      })
      .addMatcher(isComplianceThunkFulfilled, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "succeeded",
          error: null,
        };
        if (state.activeProject?.id === action.payload.projectId) {
          state.activeProject.certifierEngagement =
            reviveComplianceEngagementDates(action.payload.engagement);
        }
      })
      .addMatcher(isDeveloperApprovalFinished, (state, action) => {
        if (state.developerPendingDocument === developerDocumentOf(action)) {
          state.developerPendingDocument = null;
        }
      })
      .addMatcher(isComplianceThunkRejected, (state, action) => {
        state.complianceMutations[complianceScopeOf(action)] = {
          status: "failed",
          error:
            action.payload
            ?? action.error.message
            ?? "Unable to update the compliance file",
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
  resetProjects,
  appendFileToProject,
  removeFileFromProject,
  updateProjectTradieSchedule,
} = projectsSlice.actions;

export const selectProjectsState = (state: RootState) => state.projects;

export const selectProjectDetailUiState = (projectId: string) =>
  createSelector(selectProjectsState, (projectsState) => {
    return (
      projectsState.detailUi.byProjectId[projectId] ?? defaultDetailUiState
    );
  });

/** Shared so an untouched scope reads as one stable object, not a new one. */
const IDLE_MUTATION: ProjectMutationState = { status: "idle", error: null };

export const selectComplianceMutations = (state: RootState) =>
  state.projects.complianceMutations;

export const selectDeveloperPendingDocument = (state: RootState) =>
  state.projects.developerPendingDocument;

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
      (scope) =>
        state.projects.complianceMutations[scope]?.status === "pending",
    );

export const selectProjectUploadQueue = (projectId: string) =>
  createSelector(
    selectProjectsState,
    (projectsState) => projectsState.uploadsByProjectId[projectId] ?? {},
  );

export const selectActiveProjectBudgetSummary = createSelector(
  selectProjectsState,
  (projectsState): BudgetSummary | null => {
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
    const spentPercent =
      totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
    const status = getBudgetStatus(totalBudget, spent);

    return {
      totalBudget,
      spent,
      remaining,
      variance,
      spentPercent,
      status,
    };
  },
);

export default projectsSlice.reducer;
