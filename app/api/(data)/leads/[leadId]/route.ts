import type { Lead as PrismaLead, LeadHistory as PrismaLeadHistory, LeadStage as PrismaLeadStage } from "@prisma/client";

import prisma from "@/lib/prisma";
import type { HistoryItem, Lead as UiLead, LeadStage } from "@/lib/leads/types";
import { badRequestResponse, errorResponse, notFoundResponse, successResponse } from "@/utils/validators";

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

const historyTypeMap: Record<"SYSTEM" | "CALL" | "EMAIL" | "REFERRAL", HistoryItem["type"]> = {
  SYSTEM: "system",
  CALL: "call",
  EMAIL: "email",
  REFERRAL: "referral",
};

function toDateOnly(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date | null): string | null {
  if (!date) return null;
  return date.toTimeString().slice(0, 5);
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
    source: (lead.source ?? lead.sourceDetail ?? "Website") as UiLead["source"],
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

export async function PATCH(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse("Lead");
    }

    const body = await request.json();
    const stageValue = body?.stage as LeadStage | undefined;
    const mappedStage = stageValue ? stageToPrismaMap[stageValue] : undefined;

    if (stageValue && !mappedStage) {
      return badRequestResponse("Invalid lead stage.");
    }

    //console.log("Updating lead with id:", id, "and data:", body);
    const updatedLead = await prisma.lead.update({
      where: { id },
      data: {
        ...(body?.name !== undefined && { name: String(body.name) }),
        ...(body?.phone !== undefined && { phone: parseStringInput(body.phone) ?? "" }),
        ...(body?.email !== undefined && { email: parseStringInput(body.email) ?? "" }),
        ...(body?.location !== undefined && { location: parseStringInput(body.location) ?? "" }),
        ...(body?.source !== undefined && { source: parseStringInput(body.source) }),
        ...(body?.sourceDetail !== undefined && { sourceDetail: parseStringInput(body.sourceDetail) }),
        ...(body?.stage !== undefined && { stage: mappedStage }),
        ...(body?.assigned !== undefined && { assigned: parseStringInput(body.assigned) }),
        ...(body?.budget !== undefined && { budget: parseStringInput(body.budget) }),
        ...(body?.type !== undefined && { type: parseTypeInput(body.type) }),
        ...(body?.notes !== undefined && { notes: parseStringInput(body.notes) }),
        ...(body?.followupDate !== undefined && { followupDate: parseDateInput(body.followupDate) }),
        ...(body?.followupTime !== undefined && { followupTime: parseStringInput(body.followupTime) }),
        ...(body?.followupNotes !== undefined && { followupNotes: parseStringInput(body.followupNotes) }),
        ...(body?.lostReason !== undefined && { lostReason: parseStringInput(body.lostReason) }),
        ...(body?.urgent !== undefined && { urgent: Boolean(body.urgent) }),
        ...(body?.history && {
          history: {
            deleteMany: {},
            create: body.history.map((h: any) => ({
              action: h.action,
              detail: h.detail || "",
              type: h.type ? h.type.toUpperCase() : "SYSTEM",
              actionDate: new Date(`${h.date}T${h.time || '00:00'}`),
            })),
          }
        }),
      },
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
    });

    return successResponse(mapLead(updatedLead));
  } catch (error) {
    console.error("/api/leads PATCH error", error);
    return errorResponse("Failed to update lead", {
      status: 500,
      code: "LEAD_UPDATE_FAILED",
    });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse("Lead");
    }

    await prisma.lead.delete({ where: { id } });

    return successResponse({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("/api/leads DELETE error", error);
    return errorResponse("Failed to delete lead", {
      status: 500,
      code: "LEAD_DELETE_FAILED",
    });
  }
}
