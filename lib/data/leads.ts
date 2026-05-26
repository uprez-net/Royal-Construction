import prisma from "@/lib/prisma";
import { mapLead, stageToPrismaMap, historyTypeToPrisma } from "@/types/lead";
import type { Lead as PrismaLead, LeadHistory as PrismaLeadHistory } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import type { Lead as UiLead } from "@/lib/leads/types";

export async function getLeads(): Promise<UiLead[]> {
  try {
    const leads = await prisma.lead.findMany({
      include: { history: { orderBy: { actionDate: "asc" } } },
      orderBy: { createdAt: "desc" },
    });

    return leads.map((l) => mapLead(l as PrismaLead & { history: PrismaLeadHistory[] }));
  } catch (error) {
    console.error("Error fetching leads:", error);
    return [];
  }
}

export async function findLeadById(id: number) {
  return prisma.lead.findUnique({ where: { id }, include: { history: { orderBy: { actionDate: "asc" } } } });
}

export async function createLead(input: CreateLeadInput): Promise<UiLead> {
  const stageValue = input.stage;
  const mappedStage = stageValue ? stageToPrismaMap[stageValue] : "NEW";

  const historyInput = input.history ?? [];
  const historyCreate = historyInput.map((entry) => {
    const action = entry.action;
    const detail = entry.detail ?? "";
    const typeKey = entry.type;
    const type = historyTypeToPrisma[typeKey];
    const actionDate = entry.actionDate ?? new Date();
    return {
      action,
      detail,
      type,
      actionDate,
    };
  });

  if (historyCreate.length === 0) {
    historyCreate.push({ action: "Lead created", detail: "Lead manually created", type: "SYSTEM", actionDate: new Date() });
  }

  const created = await prisma.lead.create({
    data: {
      name: input.name,
      phone: input.phone ?? "",
      email: input.email ?? "",
      location: input.location ?? "",
      source: input.source,
      sourceDetail: input.sourceDetail,
      stage: mappedStage,
      assigned: input.assigned,
      budget: input.budget,
      type: input.type ?? [],
      notes: input.notes,
      followupDate: input.followupDate,
      followupTime: input.followupTime,
      followupNotes: input.followupNotes,
      lostReason: input.lostReason,
      urgent: input.urgent ?? false,
      history: { create: historyCreate },
    },
    include: { history: { orderBy: { actionDate: "asc" } } },
  });

  return mapLead(created as PrismaLead & { history: PrismaLeadHistory[] });
}

export async function updateLead(id: number, input: UpdateLeadInput): Promise<UiLead> {
  const mappedStage = input.stage ? stageToPrismaMap[input.stage] : undefined;

  const updateData: Partial<PrismaLead> & {
    type?: string[];
    history?: {
      deleteMany: Record<string, never>;
      create: Array<{
        action: string;
        detail: string;
        type: "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL";
        actionDate: Date;
      }>;
    };
  } = {};

  if (input.name !== undefined) updateData.name = String(input.name);
  if (input.phone !== undefined) updateData.phone = input.phone ?? "";
  if (input.email !== undefined) updateData.email = input.email ?? "";
  if (input.location !== undefined) updateData.location = input.location ?? "";
  if (input.source !== undefined) updateData.source = input.source;
  if (input.sourceDetail !== undefined) updateData.sourceDetail = input.sourceDetail;
  if (input.stage !== undefined) updateData.stage = mappedStage;
  if (input.assigned !== undefined) updateData.assigned = input.assigned;
  if (input.budget !== undefined) updateData.budget = input.budget;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.followupDate !== undefined) updateData.followupDate = input.followupDate;
  if (input.followupTime !== undefined) updateData.followupTime = input.followupTime;
  if (input.followupNotes !== undefined) updateData.followupNotes = input.followupNotes;
  if (input.lostReason !== undefined) updateData.lostReason = input.lostReason;
  if (input.urgent !== undefined) updateData.urgent = Boolean(input.urgent);

  if (input.history) {
    updateData.history = {
      deleteMany: {},
      create: input.history.map((h) => ({
        action: h.action,
        detail: h.detail || "",
        type: h.type ? (h.type.toUpperCase() as "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL") : "SYSTEM",
        actionDate: new Date(`${h.date}T${h.time || '00:00'}`),
      })),
    };
  }

  const updated = await prisma.lead.update({
    where: { id },
    data: updateData,
    include: { history: { orderBy: { actionDate: "asc" } } },
  });

  return mapLead(updated as PrismaLead & { history: PrismaLeadHistory[] });
}

export async function deleteLead(id: number) {
  await prisma.lead.delete({ where: { id } });
  return { success: true };
}
