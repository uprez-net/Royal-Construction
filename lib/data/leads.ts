import prisma from "@/lib/prisma";
import { mapLead, stageToPrismaMap, historyTypeToPrisma } from "@/types/lead";
import type { Lead as PrismaLead, LeadHistory as PrismaLeadHistory } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import type { Lead as UiLead } from "@/lib/leads/types";
import { renderEmailHtml } from "../leads/render-email-html";
import { getGraphConfig } from "../graph/config";
import { createGraphContext } from "../graph/client";

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

type CreateLeadOptions = {
  skipWelcomeEmail?: boolean;
};

export async function findLeadById(id: number) {
  return prisma.lead.findUnique({ where: { id }, include: { history: { orderBy: { actionDate: "asc" } } } });
}

export async function findLeadByEmail(email: string): Promise<UiLead | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const lead = await prisma.lead.findFirst({
    where: { email: { equals: trimmed, mode: "insensitive" } },
    include: { history: { orderBy: { actionDate: "asc" } } },
  });

  if (!lead) return null;

  return mapLead(lead as PrismaLead & { history: PrismaLeadHistory[] });
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
    include: { history: { orderBy: { actionDate: "asc" } } },
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