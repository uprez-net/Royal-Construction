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
  QUALIFIED: "Qualified",
  QUOTED: "Quoted",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
  MEETING_SCHEDULED: "Meeting Scheduled",
  IN_FOLLOW_UP: "In Follow-up",
  NO_RESPONSE: "No Response",
  CANCELLED: "Cancelled",
  DISQUALIFIED: "Disqualified",
};

export const stageToPrismaMap: Record<LeadStage, PrismaLeadStage> = {
  New: "NEW",
  Contacted: "CONTACTED",
  Qualified: "QUALIFIED",
  Quoted: "QUOTED",
  Negotiating: "NEGOTIATING",
  Won: "WON",
  Lost: "LOST",
  "Meeting Scheduled": "MEETING_SCHEDULED",
  "In Follow-up": "IN_FOLLOW_UP",
  "No Response": "NO_RESPONSE",
  Cancelled: "CANCELLED",
  Disqualified: "DISQUALIFIED",
};
// No Converted key: this is the UI -> DB WRITE map, and nothing may create a
// CONVERTED row from here on. That is what makes the phase B enum drop safe.

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

export function toDateOnly(date: Date | null): string | null {
  if (!date) return null;

  return date.toISOString().slice(0, 10);
}

export function toTimeOnly(date: Date | null): string | null {
  if (!date) return null;

  return date.toTimeString().slice(0, 5);
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
    followupDate: toDateOnly(lead.followupDate),
    followupTime: lead.followupTime ?? null,
    followupNotes: lead.followupNotes ?? "",
    followupReminderSentAt: lead.followupReminderSentAt?.toISOString() ?? null,
    meetingReminderSentAt: lead.meetingReminderSentAt?.toISOString() ?? null,
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
