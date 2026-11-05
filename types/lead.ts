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
import {
  resolveFollowup,
  type NextFollowupTask,
} from "@/lib/leads/followup-resolution";

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

const historyTypeMap: Record<PrismaHistoryType, HistoryItem["type"]> = {
  SYSTEM: "system",
  CALL: "call",
  EMAIL: "email",
  REFERRAL: "referral",
  WHATSAPP: "whatsapp",
  SMS: "sms",
};

export const historyTypeToPrisma: Record<
  HistoryItem["type"],
  PrismaHistoryType
> = {
  system: "SYSTEM",
  call: "CALL",
  email: "EMAIL",
  referral: "REFERRAL",
  whatsapp: "WHATSAPP",
  sms: "SMS",
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

export function mapHistory(
  history: PrismaLeadHistory & { author: User | null },
): HistoryItem {
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
     * The one task that decides this lead's follow-up date.
     *
     * Required, and that is the point. It used to be optional "so every
     * existing caller keeps compiling", and four of the six queries feeding
     * this function duly never asked for it — `findLeadById`, `findLeadByEmail`
     * and both create paths. `tasks` arrived as `undefined`, the guard below
     * read falsy, and those callers ALWAYS got the retired column: the lead
     * detail page, the PATCH response after every save, and the public booking
     * route showed a stale date even for a lead with a live open task. The
     * optionality is what let half a migration compile cleanly, so it is gone.
     *
     * Load it with `NEXT_FOLLOWUP_TASK`.
     */
    tasks: NextFollowupTask[];
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
  },
): UiLead {
  const assignedUserFromRelation = lead.assignedUser ?? null;
  const assignedUserFallback = lead.assigned
    ? { id: "", name: lead.assigned, email: "" }
    : null;

  const followup = resolveFollowup(
    lead.tasks,
    lead.followupDate,
    lead.followupTime,
  );

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
    estimatedStartDate: lead.estimatedStartDate?.toISOString() ?? null,
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
    // Open task -> its date. Completed task -> nothing upcoming. No task ever
    // -> the retired column. See resolveFollowup for why the middle case is
    // the whole bug: it used to fall through to a column nothing ever clears.
    followupDate: toDateOnly(followup.date),
    followupTime: followup.time,
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
    })),
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
