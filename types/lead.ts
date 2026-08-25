import { sydneyDateOnly, sydneyTimeOnly } from "@/lib/dates/sydney";
import type { SafeForecast, SafePipelineMetrics } from "@/lib/data/leads";
import type {
  ChatSession,
  HistoryType as PrismaHistoryType,
  Lead as PrismaLead,
  LeadHistory as PrismaLeadHistory,
  LeadStage as PrismaLeadStage,
  LeadEmails,
  User,
  File,
} from "@prisma/client";
import type { HistoryItem, Lead as UiLead, LeadStage } from "@/lib/leads/types";
import { coerceLeadNotesDocument } from "@/lib/rich-text/lead-notes";

export const stageMap: Record<PrismaLeadStage, LeadStage> = {
  NEW: "New",
  CONTACTED: "Contacted",
  DISCOVERY: "Discovery",
  QUALIFIED: "Qualified",
  QUOTED: "Quoted",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
  MEETING_SCHEDULED: "Meeting Scheduled",
  IN_FOLLOW_UP: "In Follow-up",
  NO_RESPONSE: "No Response",
  CONVERTED: "Converted",
  CANCELLED: "Cancelled",
  DISQUALIFIED: "Disqualified",
};

export const stageToPrismaMap: Record<LeadStage, PrismaLeadStage> = {
  New: "NEW",
  Contacted: "CONTACTED",
  Discovery: "DISCOVERY",
  Qualified: "QUALIFIED",
  Quoted: "QUOTED",
  Negotiating: "NEGOTIATING",
  Won: "WON",
  Lost: "LOST",
  "Meeting Scheduled": "MEETING_SCHEDULED",
  "In Follow-up": "IN_FOLLOW_UP",
  "No Response": "NO_RESPONSE",
  Converted: "CONVERTED",
  Cancelled: "CANCELLED",
  Disqualified: "DISQUALIFIED",
};

const historyTypeMap: Record<"SYSTEM" | "CALL" | "EMAIL" | "REFERRAL", HistoryItem["type"]> = {
  SYSTEM: "system",
  CALL: "call",
  EMAIL: "email",
  REFERRAL: "referral",
};

export const historyTypeToPrisma: Record<HistoryItem["type"], PrismaHistoryType> = {
  system: "SYSTEM",
  call: "CALL",
  email: "EMAIL",
  referral: "REFERRAL",
};

/**
 * The calendar date in Sydney, not in UTC.
 *
 * These read `toISOString()` and `toTimeString()`, which are UTC and
 * server-local respectively. Every date the office looks at is a Sydney date,
 * and Sydney is 10-11 hours ahead, so anything stored between midnight and
 * ~10am Sydney printed as the PREVIOUS day: a task due Wed 26 Aug showed as
 * 25 Aug, and a lead entered at 9am showed as "Created" yesterday. On Vercel
 * the server clock is UTC, so toTimeString() was wrong by the same margin.
 *
 * lib/dates/sydney.ts already existed for exactly this; these two predate it
 * and were never migrated.
 */
export function toDateOnly(date: Date | null): string | null {
  if (!date) return null;

  return sydneyDateOnly(date);
}

export function toTimeOnly(date: Date | null): string | null {
  if (!date) return null;

  return sydneyTimeOnly(date);
}

export function mapHistory(history: PrismaLeadHistory & { author: User | null }): HistoryItem {
  return {
    date: toDateOnly(history.actionDate) ?? "",
    time: toTimeOnly(history.actionDate) ?? "",
    action: history.action,
    detail: history.detail,
    type: historyTypeMap[history.type],
    author: history.author
      ? {
          id: history.author.id,
          name: history.author.name,
          email: history.author.email,
        }
      : null,
  };
}

export function mapLead(
  lead: PrismaLead & {
    history: (PrismaLeadHistory & { author: User | null })[];
    chatSessions: ChatSession[];
    assignedUser?: { id: string; name: string; email: string } | null;
    /**
     * The lead's next open task, when the caller asked for it.
     *
     * Optional so every existing caller keeps compiling; when it is absent the
     * mapping falls back to the retired columns below.
     */
    tasks?: { dueDate: Date | null; dueTime: string | null }[];
    noteAnnotations?: Array<{
      id: string;
      selectedText: string;
      comment: string;
      mentionedUserIds: string[];
      status: "OPEN" | "RESOLVED";
      createdAt: Date;
      resolvedAt: Date | null;
    }>;
    emails: LeadEmails[];
    files: File[];
  }
): UiLead {
  const assignedUserFromRelation = lead.assignedUser ?? null;
  const assignedUserFallback = lead.assigned ? { id: "", name: lead.assigned, email: "" } : null;

  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    location: lead.location ?? "",
    secondaryName: lead.secondaryName ?? null,
    secondaryEmail: lead.secondaryEmail ?? null,
    secondaryPhone: lead.secondaryPhone ?? null,
    source: (lead.source ?? lead.sourceDetail ?? "Website") as UiLead["source"],
    sourceDetail: lead.sourceDetail ?? "",
    stage: stageMap[lead.stage],
    assignedId: lead.assignedId ?? null,
    assignedUser: assignedUserFromRelation ?? assignedUserFallback,
    budget: lead.budget ?? "Not Discussed",
    // mapLead is an explicit whitelist with no spread — new Prisma columns do
    // NOT flow through on their own.
    estimatedValue: lead.estimatedValue?.toString() ?? null,
    estimatedValueSource: lead.estimatedValueSource ?? null,
    probabilityOverride: lead.probabilityOverride ?? null,
    expectedCloseDate: lead.expectedCloseDate?.toISOString() ?? null,
    type: lead.type.length > 0 ? lead.type.join(", ") : "Not Specified",
    notes: lead.notes ?? "",
    notesDoc: coerceLeadNotesDocument(lead.notesDoc, lead.notes ?? ""),
    noteAnnotations: (lead.noteAnnotations ?? []).map((annotation) => ({
      id: annotation.id,
      selectedText: annotation.selectedText,
      comment: annotation.comment,
      mentionedUserIds: annotation.mentionedUserIds,
      status: annotation.status === "RESOLVED" ? "resolved" : "open",
      createdAt: annotation.createdAt.toISOString(),
      resolvedAt: annotation.resolvedAt?.toISOString() ?? null,
    })),
    meetingDate: toDateOnly(lead.meetingDate),
    meetingTime: lead.meetingTime ?? null,
    meetingMode: lead.meetingMode ?? null,
    // The next open task first, the retired column only as a fallback.
    //
    // Lead.followupDate is no longer written by the thing that books work: the
    // Set date dialog creates a LeadTask and sends updateLead nothing but a
    // history entry. The table's Follow-up cell reads these two fields, so it
    // stayed blank however many times someone booked a call — which read as
    // "that did not save", so they booked it again, and each attempt added
    // another task to the count. Only Add Lead still writes the column, which
    // is why it is populated for some leads and never for others.
    //
    // The fallback keeps legacy rows that carry a date but no task rendering.
    // Presence of a task decides, not the date on it. An open task with no due
    // date is real work deliberately left unscheduled; `?? lead.followupDate`
    // would have skipped past its null and shown a stale legacy date instead,
    // which is worse than showing nothing.
    followupDate: toDateOnly(
      lead.tasks && lead.tasks.length > 0 ? lead.tasks[0].dueDate : lead.followupDate,
    ),
    followupTime:
      lead.tasks && lead.tasks.length > 0
        ? lead.tasks[0].dueTime
        : (lead.followupTime ?? null),
    followupNotes: lead.followupNotes ?? "",
    followupReminderSentAt: lead.followupReminderSentAt?.toISOString() ?? null,
    meetingReminderSentAt: lead.meetingReminderSentAt?.toISOString() ?? null,
    followupCompletedAt: lead.followupCompletedAt?.toISOString() ?? null,
    meetingCompletedAt: lead.meetingCompletedAt?.toISOString() ?? null,
    lostReason: lead.lostReason ?? undefined,
    history: lead.history.map(mapHistory),
    created: toDateOnly(lead.createdAt) ?? "",
    urgent: lead.urgent,
    creatingOffer: lead.chatSessions.length > 0,
    runId: lead.runId,
    runStatus: lead.runStatus,
    emails: lead.emails,
    isArchived: lead.isArchived,
    uploadedFiles: lead.files.map((file) => ({
      id: file.id,
      name: file.filename,
      size: file.filesize,
      url: file.url,
    }))
  };
}

export interface LeadAnalyticsData {
  sourceData: { name: string; value: number }[];
  conversionData: { source: string; total: number; won: number }[];
  monthlyTrend: { month: string; leads: number; converted: number }[];
  lostReasons: { name: string; value: number }[];
  /** Money fields arrive as strings — Decimal cannot cross to the client. */
  pipelineMetrics: SafePipelineMetrics;
  forecast: SafeForecast;
}
