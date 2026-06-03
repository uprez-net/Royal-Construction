"use server";
import prisma from "@/lib/prisma";
import { mapLead, stageToPrismaMap, historyTypeToPrisma, LeadAnalyticsData } from "@/types/lead";
import type { Lead as PrismaLead, LeadHistory as PrismaLeadHistory } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import type { LeadsStats, Lead as UiLead } from "@/lib/leads/types";
import { renderEmailHtml } from "../leads/render-email-html";
import { getGraphConfig } from "../graph/config";
import { createGraphContext } from "../graph/client";
import { Prisma, ChatSession } from "@prisma/client";

const defaultLookupPageSize = 10;

function normalizeSearch(search?: string) {
  return search?.trim() ?? "";
}

export interface PaginatedLeadsResult {
  items: UiLead[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export async function getLeads(page = 1, limit = defaultLookupPageSize, query?: string): Promise<PaginatedLeadsResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : defaultLookupPageSize;
  const search = normalizeSearch(query);

  const where: Prisma.LeadWhereInput | undefined = search.length > 0
    ? {
      OR: [
        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
      ],
    }
    : undefined;
  try {
    const leads = await prisma.lead.findMany({
      where,
      include: {
        history: { orderBy: { actionDate: "asc" } },
        chatSessions: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    const totalCount = await prisma.lead.count({ where });

    return {
      items: leads.map((l) => mapLead(l as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] })),
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    };
  } catch (error) {
    console.error("Error fetching leads:", error);
    return {
      items: [],
      page: 1,
      limit: defaultLookupPageSize,
      totalCount: 0,
      totalPages: 0,
    };
  }
}

type CreateLeadOptions = {
  skipWelcomeEmail?: boolean;
};

export async function findLeadById(id: number): Promise<UiLead | null> {
  const lead = await prisma.lead.findUnique({ where: { id }, include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true } });
  if (!lead) return null;
  return mapLead(lead);
}

export async function findLeadByEmail(email: string): Promise<UiLead | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const lead = await prisma.lead.findFirst({
    where: { email: { equals: trimmed, mode: "insensitive" } },
    include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true },
  });

  if (!lead) return null;

  return mapLead(lead as PrismaLead & { history: PrismaLeadHistory[]; chatSessions: ChatSession[] });
}

export async function createLead(input: CreateLeadInput, options?: CreateLeadOptions): Promise<UiLead> {
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
    include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true },
  });

  // ═══════════════════════════════════════════════════════
  // SEND WELCOME EMAIL TO MANUALLY CREATED LEADS
  // ═══════════════════════════════════════════════════════
  if (!options?.skipWelcomeEmail && created.email && created.name) {
    console.log(`[Lead ${created.id}] Sending welcome email to newly created lead...`);
    try {
      // 1. Map Prisma Lead to LeadPreview shape (converting null to undefined)
      const leadPreview = {
        name: created.name,
        email: created.email,
        type: created.type,
        location: created.location,
        notes: created.notes ?? undefined,
        budget: created.budget ?? undefined,
      };

      // 2. Generate the HTML body using your React Email template
      const htmlBody = await renderEmailHtml('Welcome', leadPreview);

      if (htmlBody) {
        // 3. Initialize Graph Client
        const config = getGraphConfig();
        const graphClient = await createGraphContext(config);

        // 4. Define the subject line
        const emailSubject = 'Welcome to Royal Constructions — Your Home Building Journey Starts Here';

        // 5. Send the email directly using the Graph Client
        await graphClient.sendMail({
          to: created.email,
          subject: emailSubject,
          body: htmlBody
        });

        console.log(`[Lead ${created.id}] ✅ Welcome email successfully sent to ${created.email}`);
      } else {
        console.warn(`[Lead ${created.id}] ⚠️ Failed to render welcome email HTML. No email sent.`);
      }
    } catch (emailError) {
      console.error(`[Lead ${created.id}] ❌ Failed to send welcome email:`, emailError);
    }
  }

  return mapLead(created as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] });
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
    include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true },
  });

  return mapLead(updated as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] });
}

export async function deleteLead(id: number) {
  await prisma.lead.delete({ where: { id } });
  return { success: true };
}

export async function getLeadsStats(): Promise<LeadsStats> {
  const [totalLeads, newLeads, contactedLeads, qualifiedLeads, wonLeads, lostLeads, pendingFollowupLeads] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { stage: "NEW" } }),
    prisma.lead.count({ where: { stage: "CONTACTED" } }),
    prisma.lead.count({ where: { stage: "QUALIFIED" } }),
    prisma.lead.count({ where: { stage: { in: ["WON", "CONVERTED"] } } }),
    prisma.lead.count({ where: { stage: { in: ["LOST", "CANCELLED", "DISQUALIFIED"] } } }),
    prisma.lead.count({ where: { stage: { notIn: ["WON", "CONVERTED", "LOST", "CANCELLED", "DISQUALIFIED"] } } }),
  ]);

  return {
    total: totalLeads,
    new: newLeads,
    contacted: contactedLeads,
    qualified: qualifiedLeads,
    conversion: wonLeads,
    pendingFollowup: pendingFollowupLeads,
    lost: lostLeads,
  };
}

export async function getAnalyticsData(): Promise<LeadAnalyticsData> {
  const leads = await prisma.lead.findMany({
    include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true },
  });
  const mappedLeads = leads.map((l) => mapLead(l));

  /* Source distribution */
  const sourceMap = mappedLeads.reduce((acc, lead) => {
    acc[lead.source] = (acc[lead.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sourceData = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  /* Conversion by source */
  const convMap = mappedLeads.reduce((acc, lead) => {
    if (!acc[lead.source]) acc[lead.source] = { total: 0, won: 0 };
    acc[lead.source].total++;
    if (lead.stage === 'Won') acc[lead.source].won++;
    return acc;
  }, {} as Record<string, { total: number; won: number }>);

  const conversionData = Object.entries(convMap).map(([source, stats]) => ({
    source,
    total: stats.total,
    won: stats.won,
  }));

  return { sourceData, conversionData };
}