import type {
    ChatSession,
    HistoryType as PrismaHistoryType,
    Lead as PrismaLead,
    LeadHistory as PrismaLeadHistory,
    LeadStage as PrismaLeadStage,
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
    CONVERTED: "Converted",
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
    Converted: "CONVERTED",
    Cancelled: "CANCELLED",
    Disqualified: "DISQUALIFIED",
};

const historyTypeMap: Record<
    "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL",
    HistoryItem["type"]
> = {
    SYSTEM: "system",
    CALL: "call",
    EMAIL: "email",
    REFERRAL: "referral",
};

export const historyTypeToPrisma: Record<
    HistoryItem["type"],
    PrismaHistoryType
> = {
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

export function mapHistory(history: PrismaLeadHistory): HistoryItem {
    return {
        date: toDateOnly(history.actionDate) ?? "",
        time: toTimeOnly(history.actionDate) ?? "",
        action: history.action,
        detail: history.detail,
        type: historyTypeMap[history.type],
    };
}

export function mapLead(
    lead: PrismaLead & {
        history: PrismaLeadHistory[];
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
        source: (lead.source ?? lead.sourceDetail ?? "Website") as UiLead["source"],
        sourceDetail: lead.sourceDetail ?? "",
        stage: stageMap[lead.stage],
        assignedId: lead.assignedId ?? null,
        assignedUser: assignedUserFromRelation ?? assignedUserFallback,
        budget: lead.budget ?? "Not Discussed",
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
        followupDate: toDateOnly(lead.followupDate),
        followupTime: lead.followupTime ?? null,
        followupNotes: lead.followupNotes ?? "",
        lostReason: lead.lostReason ?? undefined,
        history: lead.history.map(mapHistory),
        created: toDateOnly(lead.createdAt) ?? "",
        urgent: lead.urgent,
        creatingOffer: lead.chatSessions.length > 0,
    };
}

export interface LeadAnalyticsData {
    sourceData: { name: string; value: number }[];
    conversionData: { source: string; total: number; won: number }[];
    monthlyTrend: { month: string; leads: number; converted: number }[];
    lostReasons: { name: string; value: number }[];
}
