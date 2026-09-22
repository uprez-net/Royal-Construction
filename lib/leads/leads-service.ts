"use client";
import {
  HistoryItem,
  Lead,
  LeadNoteAnnotationInput,
  LeadsStats,
  LeadStage,
} from "./types";
import { FetchError, fetchJson } from "@/utils/fetch";
import {
  findLeadById,
  getAllLeads,
  getAnalyticsData,
  getFollowupStats,
  getLeadsStats,
} from "../actions/leads";
import type { PaginatedLeadsResult } from "../data/leads";
import { sendCampaignEmail } from "../data/email-ad-hock";

export interface LeadHistoryInput extends Pick<
  HistoryItem,
  "action" | "detail" | "type"
> {
  actionDate: string;
}

export interface FetchLeadsParams {
  page?: number;
  limit?: number;
  q?: string;
}

export type LeadCreatePayload = Omit<
  Lead,
  | "id"
  | "created"
  | "history"
  | "type"
  | "creatingOffer"
  | "runId"
  | "runStatus"
  | "emails"
  | "isArchived"
  | "uploadedFiles"
> & {
  type?: string | string[];
  history?: LeadHistoryInput[];
};

/**
 * Service for fetching and managing leads data
 * This is structured to easily swap dummy data with backend API calls
 * Just replace the function bodies with API calls when backend is ready
 */

// ── Fetch all leads ──
export async function fetchLeadAnalyticsData() {
  return getAnalyticsData();
}

export async function fetchAllLeads(): Promise<Lead[]> {
  const data = await getAllLeads();
  return data;
}

export async function fetchLeads(params: {
  q?: string;
  limit?: number;
  page?: number;
  status?: LeadStage[];
  filterTiming?: string;
  isArchived?: boolean;
  hasOpenTask?: boolean;
  pendingFollowUps?: boolean;
  upcomingFollowUps?: boolean;
  pendingMeetings?: boolean;
  upcomingMeetings?: boolean;
}): Promise<PaginatedLeadsResult> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.append("q", params.q.trim());
  if (params.limit) query.append("limit", params.limit.toString());
  if (params.page) query.append("page", params.page.toString());
  if (params.status) query.append("status", params.status.join(","));
  if (params.filterTiming) query.append("filterTiming", params.filterTiming);
  if (params.isArchived !== undefined)
    query.append("isArchived", params.isArchived.toString());
  if (params.hasOpenTask) query.append("hasOpenTask", "true");
  if (params.pendingFollowUps !== undefined)
    query.append("pendingFollowUps", params.pendingFollowUps.toString());
  if (params.upcomingFollowUps !== undefined)
    query.append("upcomingFollowUps", params.upcomingFollowUps.toString());
  if (params.pendingMeetings !== undefined)
    query.append("pendingMeetings", params.pendingMeetings.toString());
  if (params.upcomingMeetings !== undefined)
    query.append("upcomingMeetings", params.upcomingMeetings.toString());
  const data = await fetchJson<PaginatedLeadsResult>(
    `/api/leads?${query.toString()}`,
    { method: "GET", cache: "no-store" },
    "Failed to fetch leads",
  );

  if (!data.success) {
    throw new Error("Failed to fetch leads");
  }

  return data.data;
}

export async function fetchLead(id: number): Promise<Lead | null> {
  const lead = await findLeadById(id);
  return lead;
}

export async function fetchLeadsStats(): Promise<LeadsStats> {
  return getLeadsStats();
}

export async function fetchFollowupStats() {
  return getFollowupStats();
}

// export async function FollowupCalendarCreation(leadName: string, leadEmail: string, followupDate: string, followupTime: string): Promise<string | null> {
//   return handleCalendarFollowup({ name: leadName, email: leadEmail } as Lead, followupDate, followupTime);
// }

export type DuplicateLeadResult = { message: string; existingLead: Lead };

export function isDuplicateLeadResult(
  result: Lead | DuplicateLeadResult,
): result is DuplicateLeadResult {
  return "message" in result;
}

/**
 * Read the duplicate payload out of a rejected create. The route answers a
 * duplicate with 409 + `{ message, existingLead }`, which fetchJson treats as a
 * failure — so the useful half of that answer only survives if it is unpacked
 * from the error body here.
 */
function duplicateFromError(error: unknown): DuplicateLeadResult | null {
  if (!(error instanceof FetchError) || error.status !== 409) return null;

  const body = error.body;
  if (!body || typeof body !== "object") return null;

  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;

  const { message, existingLead } = data as Partial<DuplicateLeadResult>;
  if (typeof message !== "string" || !message.trim() || !existingLead)
    return null;

  return { message, existingLead };
}

export async function createLead(
  leadData: LeadCreatePayload,
): Promise<Lead | DuplicateLeadResult> {
  try {
    const response = await fetchJson<Lead | DuplicateLeadResult>(
      "/api/leads",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(leadData),
      },
      "Failed to create lead",
    );

    return response.data;
  } catch (error) {
    const duplicate = duplicateFromError(error);
    if (duplicate) return duplicate;
    throw error;
  }
}

type LeadUpdatePayload = Partial<Omit<Lead, "runId" | "emails">> & {
  annotationsToCreate?: LeadNoteAnnotationInput[];
};

export async function updateLead(
  id: number,
  updates: LeadUpdatePayload,
): Promise<Lead | null> {
  // console.log('Updating lead with id:', id, 'and updates:', updates);
  const response = await fetchJson<Lead>(
    `/api/leads/${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Failed to update lead",
  );

  const payload = response.data;

  return payload;
}

export async function deleteLead(
  id: number,
): Promise<{ success: boolean; message: string }> {
  const response = await fetchJson<{ success: boolean; message: string }>(
    `/api/leads/${id}`,
    {
      method: "DELETE",
    },
    "Failed to delete lead",
  );

  const payload = response.data;

  return payload;
}

export async function sendEmailToLead(
  to: string,
  subject: string,
  body: string,
  /**
   * One press of Send. Pass it from a campaign so a retried batch or a second
   * click does not email the same lead twice; omit it for a one-off send,
   * where there is no run to be a duplicate of.
   */
  runId?: string,
): Promise<boolean> {
  // Delegate to the server action which calls the Graph client directly,
  // bypassing the /api/graph/send route and its admin-token requirement.
  return sendCampaignEmail(to, subject, body, runId);
}
