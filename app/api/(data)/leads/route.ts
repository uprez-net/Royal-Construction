import type { HistoryType as PrismaHistoryType, Lead as PrismaLead, LeadHistory as PrismaLeadHistory, LeadStage as PrismaLeadStage } from "@prisma/client";

import prisma from "@/lib/prisma";
import type { HistoryItem, Lead as UiLead, LeadSource, LeadStage } from "@/lib/leads/types";
import { badRequestResponse, errorResponse, successResponse } from "@/utils/validators";

const stageMap: Record<PrismaLeadStage, LeadStage> = {
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

const stageToPrismaMap: Record<LeadStage, PrismaLeadStage> = {
  "New": "NEW",
  "Contacted": "CONTACTED",
  "Qualified": "QUALIFIED",
  "Quoted": "QUOTED",
  "Negotiating": "NEGOTIATING",
  "Won": "WON",
  "Lost": "LOST",
  "Meeting Scheduled": "MEETING_SCHEDULED",
  "In Follow-up": "IN_FOLLOW_UP",
  "No Response": "NO_RESPONSE",
  "Converted": "CONVERTED",
  "Cancelled": "CANCELLED",
  "Disqualified": "DISQUALIFIED",
};

const historyTypeMap: Record<PrismaHistoryType, HistoryItem["type"]> = {
  SYSTEM: "system",
  CALL: "call",
  EMAIL: "email",
  REFERRAL: "referral",
};

const historyTypeToPrisma: Record<HistoryItem["type"], PrismaHistoryType> = {
  system: "SYSTEM",
  call: "CALL",
  email: "EMAIL",
  referral: "REFERRAL",
};

const leadSourceSet = new Set<LeadSource>([
  "Google Ads",
  "Referral",
  "Facebook Ads",
  "Walk-in",
  "Repeat Client",
  "Website",
  "Personal",
  "Business",
]);

function normalizeSource(source: string | null, sourceDetail: string | null): LeadSource {
  const raw = (source ?? sourceDetail ?? "").trim();
  if (leadSourceSet.has(raw as LeadSource)) {
    return raw as LeadSource;
  }
  return "Website";
}

function toDateOnly(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date | null): string | null {
  if (!date) return null;
  return date.toTimeString().slice(0, 5);
}

function parseDateInput(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTypeInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function parseStringInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapHistory(history: PrismaLeadHistory): HistoryItem {
  return {
    date: toDateOnly(history.actionDate) ?? "",
    time: toTimeOnly(history.actionDate) ?? "",
    action: history.action,
    detail: history.detail,
    type: historyTypeMap[history.type],
  };
}

function mapLead(lead: PrismaLead & { history: PrismaLeadHistory[] }): UiLead {
  const typeLabel = lead.type.length > 0 ? lead.type.join(", ") : "Not Specified";

  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    location: lead.location ?? "",
    source: normalizeSource(lead.source, lead.sourceDetail),
    sourceDetail: lead.sourceDetail ?? "",
    stage: stageMap[lead.stage],
    assigned: lead.assigned ?? null,
    budget: lead.budget ?? "Not Discussed",
    type: typeLabel,
    notes: lead.notes ?? "",
    followupDate: toDateOnly(lead.followupDate),
    followupTime: lead.followupTime ?? null,
    followupNotes: lead.followupNotes ?? "",
    lostReason: lead.lostReason ?? undefined,
    history: lead.history.map(mapHistory),
    created: toDateOnly(lead.createdAt) ?? "",
    urgent: lead.urgent,
  };
}

export async function GET() {
  try {
    console.log("Fetching leads from database...");
    const leads = await prisma.lead.findMany({
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(leads.map(mapLead));
  } catch (error) {
    console.error("/api/leads GET error", error);
    return errorResponse("Failed to fetch leads", {
      status: 500,
      code: "LEADS_FETCH_FAILED",
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = parseStringInput(body?.name);

    if (!name) {
      return badRequestResponse("Lead name is required.");
    }

    const stageValue = body?.stage as LeadStage | undefined;
    const mappedStage = stageValue ? stageToPrismaMap[stageValue] : "NEW";

    if (stageValue && !mappedStage) {
      return badRequestResponse("Invalid lead stage.");
    }

    const historyInput = Array.isArray(body?.history) ? body.history : [];
    const historyCreate = historyInput.map((entry: { action?: unknown; detail?: unknown; type?: unknown; actionDate?: unknown }) => {
      const action = parseStringInput(entry.action) ?? "Note";
      const detail = parseStringInput(entry.detail) ?? "";
      const typeKey = entry.type as HistoryItem["type"] | undefined;
      const type = typeKey && historyTypeToPrisma[typeKey] ? historyTypeToPrisma[typeKey] : "SYSTEM";
      const actionDate = parseDateInput(entry.actionDate) ?? new Date();
      return {
        action,
        detail,
        type,
        actionDate,
      };
    });

    if (historyCreate.length === 0) {
      historyCreate.push({
        action: "Lead created",
        detail: "Lead manually created",
        type: "SYSTEM",
        actionDate: new Date(),
      });
    }

    const createdLead = await prisma.lead.create({
      data: {
        name,
        phone: parseStringInput(body?.phone) ?? "",
        email: parseStringInput(body?.email) ?? "",
        location: parseStringInput(body?.location) ?? "",
        source: parseStringInput(body?.source),
        sourceDetail: parseStringInput(body?.sourceDetail),
        stage: mappedStage,
        assigned: parseStringInput(body?.assigned),
        budget: parseStringInput(body?.budget),
        type: parseTypeInput(body?.type),
        notes: parseStringInput(body?.notes),
        followupDate: parseDateInput(body?.followupDate),
        followupTime: parseStringInput(body?.followupTime),
        followupNotes: parseStringInput(body?.followupNotes),
        lostReason: parseStringInput(body?.lostReason),
        urgent: Boolean(body?.urgent),
        history: {
          create: historyCreate,
        },
      },
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
    });

    return successResponse(mapLead(createdLead), { status: 201 });
  } catch (error) {
    console.error("/api/leads POST error", error);
    return errorResponse("Failed to create lead", {
      status: 500,
      code: "LEAD_CREATE_FAILED",
    });
  }
}
