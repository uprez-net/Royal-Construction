"use server";
import prisma from "@/lib/prisma";
import { mapLead, stageToPrismaMap, historyTypeToPrisma, LeadAnalyticsData } from "@/types/lead";
import type { LeadStage, Lead as PrismaLead, LeadHistory as PrismaLeadHistory } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import type { Lead, LeadsStats, Lead as UiLead } from "@/lib/leads/types";
import { renderEmailHtml } from "../leads/render-email-html";
import { getGraphConfig } from "../graph/config";
import { createGraphContext } from "../graph/client";
import { Prisma, ChatSession } from "@prisma/client";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { ClientSecretCredential } from "@azure/identity";
import { render } from "@react-email/components";
import FollowUpStageMeeting from "../graph/Email/followupstageMeetingcreation";
import {
  format,
  subMonths,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";


const defaultLookupPageSize = 10; // Set to Infinity to fetch all leads without pagination

function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLeadDedupeLockKeys(email: string, phone: string) {
  return [
    email === "" ? null : `lead:email:${email.toLowerCase()}`,
    phone === "" ? null : `lead:phone:${phone}`,
  ].filter((key): key is string => key !== null).sort();
}

async function lockLeadDedupeKeys(tx: Prisma.TransactionClient, keys: string[]) {
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

async function sendLeadMentionEmails(input: {
  leadId: number;
  leadName: string;
  selectedText: string;
  comment: string;
  mentionedUserIds: string[];
}) {
  if (input.mentionedUserIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: input.mentionedUserIds } },
    select: { email: true, name: true },
  });

  if (users.length === 0) return;

  const config = getGraphConfig();
  const graphClient = await createGraphContext(config);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://royal-construction-chi.vercel.app";
  const crmUrl = `${baseUrl}/leads`;
  const leadName = escapeEmailHtml(input.leadName);
  const selectedText = escapeEmailHtml(input.selectedText);
  const comment = escapeEmailHtml(input.comment);

  const recipients = users.filter((user) => user.email);
  if (recipients.length === 0) {
    console.warn(`[Lead ${input.leadId}] No email addresses found for mentioned users.`);
    return;
  }

  const results = await Promise.allSettled(
    recipients.map((user) =>
      graphClient.sendMail({
        to: user.email,
        subject: `[Lead Note] ${input.leadName} needs your attention`,
        body: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
              <p>Hi ${escapeEmailHtml(user.name || "Team")},</p>
              <p>You were mentioned in a Royal Constructions lead note.</p>
              <p><strong>Lead:</strong> ${leadName}</p>
              <p><strong>Note:</strong></p>
              <blockquote style="border-left: 3px solid #c6923a; margin: 0 0 12px; padding: 8px 12px; background: #fbfaf7;">${selectedText}</blockquote>
              <p><strong>Reason:</strong></p>
              <p>${comment}</p>
              <p><a href="${crmUrl}" style="color: #0d9488;">Open Lead Pipeline</a></p>
            </div>
          `,
      }),
    ),
  );

  const failed = results
    .map((result, index) => ({ result, user: recipients[index] }))
    .filter(({ result }) => result.status === "rejected");

  if (failed.length > 0) {
    console.error(`[Lead ${input.leadId}] Failed to email ${failed.length} mentioned user(s).`, failed);
  }
}

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

export async function getAllLeads(): Promise<UiLead[]> {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        history: { orderBy: { actionDate: "asc" } },
        chatSessions: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        noteAnnotations: { orderBy: { createdAt: "desc" } },
      },
    });
    return leads.map((lead) => mapLead(lead));
  } catch (error) {
    console.error("Error fetching all leads:", error);
    throw new Error("Failed to fetch leads");
  }
}

export async function getLeads(page = 1, limit = defaultLookupPageSize, query?: string, status?: LeadStage[], filterTiming?: string): Promise<PaginatedLeadsResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : defaultLookupPageSize;
  const search = normalizeSearch(query);

  // 1. Determine if a timing filter should be active (skip if undefined or 'all')
  const hasTimingFilter = filterTiming && filterTiming !== 'all';
  let timingFilter = {};

  if (hasTimingFilter) {
    const timeZone = "Australia/Sydney";

    // Current date in Sydney
    const sydneyNow = toZonedTime(new Date(), timeZone);

    let startSydney: Date;
    let endSydney: Date;

    switch (filterTiming) {
      case "today":
        startSydney = startOfDay(sydneyNow);
        endSydney = endOfDay(sydneyNow);
        break;

      case "this_week":
        startSydney = startOfWeek(sydneyNow, { weekStartsOn: 1 }); // Monday
        endSydney = endOfWeek(sydneyNow, { weekStartsOn: 1 });
        break;

      case "this_month":
        startSydney = startOfMonth(sydneyNow);
        endSydney = endOfMonth(sydneyNow);
        break;

      case "quarter":
        startSydney = startOfQuarter(sydneyNow);
        endSydney = endOfQuarter(sydneyNow);
        break;

      case "this_year":
        startSydney = startOfYear(sydneyNow);
        endSydney = endOfYear(sydneyNow);
        break;

      default:
        startSydney = startOfDay(sydneyNow);
        endSydney = endOfDay(sydneyNow);
    }

    // Convert Sydney boundaries back to UTC for Prisma
    const startUTC = fromZonedTime(startSydney, timeZone);
    const endUTC = fromZonedTime(endSydney, timeZone);

    timingFilter = {
      createdAt: {
        gte: startUTC,
        lte: endUTC,
      },
    };
  }




  const where: Prisma.LeadWhereInput | undefined = search.length > 0
    ? {
      OR: [
        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
      ],
    }
    : undefined;
  try {
    const leads = await prisma.lead.findMany({
      where: {
        ...where,
        ...timingFilter,
        ...(status && status.length > 0
          ? { stage: { in: status } }
          : {}),
      },
      include: {
        history: { orderBy: { actionDate: "asc" } },
        chatSessions: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        noteAnnotations: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    const totalCount = await prisma.lead.count({
      where: {
        ...where,
        ...timingFilter,
        ...(status && status.length > 0
          ? { stage: { in: status } }
          : {}),
      }
    });

    const items = leads.map((lead) => mapLead(lead as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] } & { assignedUser: { id: string; name: string; email: string } | null }));

    return {
      items,
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
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      history: {
        orderBy: { actionDate: "asc" }
      },
      chatSessions: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      noteAnnotations: { orderBy: { createdAt: "desc" } },
    }
  });
  if (!lead) return null;
  return mapLead(lead);
}

export async function findLeadByEmail(id: number): Promise<UiLead | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      history: { orderBy: { actionDate: "asc" } },
      chatSessions: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      noteAnnotations: { orderBy: { createdAt: "desc" } },
    }
  });
  if (!lead) return null;

  return mapLead(lead as PrismaLead & { history: PrismaLeadHistory[]; chatSessions: ChatSession[]; assignedUser: { id: string; name: string; email: string } | null });
}

export async function handleCalendarFollowup(
  lead: Lead,
  followupDate: string, // e.g., "2026-06-06"
  followupTime: string  // e.g., "09:00" or "21:00"
): Promise<string | null> {

  const config = getGraphConfig();
  if (config.mode !== 'app-only' || !config.senderUpn) {
    return "Graph API configuration is not set for app-only mode with a valid sender UPN.";
  }

  const credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
  const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
  const accessToken = tokenResult?.token;

  if (!accessToken) throw new Error('Unable to acquire Graph access token');

  // ─── 1. Date & Time Parsing & Formatting ─────────────────────────────

  // Parse local start time (Assuming followupDate is YYYY-MM-DD and followupTime is HH:mm)
  const startDateTime = new Date(`${followupDate}T${followupTime}:00`);

  // Calculate end time locally (adds 1 hour, automatically handles day rollovers like 23:30 -> 00:30)
  const endDateTimeObj = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  // Helper: Format Date object to Graph API accepted Local String "YYYY-MM-DDTHH:mm:ss"
  const pad = (n: number) => n.toString().padStart(2, '0');
  const formatToGraphDateTime = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  const graphStartStr = formatToGraphDateTime(startDateTime);
  const graphEndStr = formatToGraphDateTime(endDateTimeObj);

  // Helper: Format Date object to requested email display strings
  const formatDisplayDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); // "Saturday 6 June 2026"

  const formatDisplayTime = (d: Date) => {
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const formattedHours = (hours % 12 || 12).toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  };

  const displayDate = formatDisplayDate(startDateTime);
  const displayTime = `${formatDisplayTime(startDateTime)} - ${formatDisplayTime(endDateTimeObj)} (AEST)`;

  // ─── 2. Render React Email to HTML String ────────────────────────────

  const emailHtml = await render(
    FollowUpStageMeeting({
      name: lead.name,
      formattedDate: displayDate,
      formattedTime: displayTime,

    })
  );

  const attendees = [
    {
      emailAddress: { address: lead.email, name: lead.name },
      type: 'required' // Main Lead
    }
  ];

  // Add CC from .env if it exists (Graph API uses 'optional' type for CC)
  const ccEmail = process.env.MAIL_ID_CC;
  if (ccEmail) {
    attendees.push({
      emailAddress: { address: ccEmail, name: 'Admin' },
      type: 'optional' // This acts as the CC in Outlook Calendar
    });
  }

  // ─── 3. Construct Graph API Payload ──────────────────────────────────

  const event = {
    subject: `Follow-Up Calendar Event with ${lead.name} - Royal Constructions`,
    body: {
      contentType: 'HTML',
      content: emailHtml, // Inject the beautifully styled React Email HTML
    },
    start: {
      dateTime: graphStartStr,
      timeZone: 'Australia/Sydney'
    },
    end: {
      dateTime: graphEndStr,
      timeZone: 'Australia/Sydney'
    },
    location: { displayName: 'Royal Constructions' },
    attendees: attendees,
  };

  // ─── 4. Send Request to Graph API ────────────────────────────────────

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        // This header makes Graph return timezone properties in AEST in the response
        'Prefer': 'outlook.timezone="Australia/Sydney"'
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error('Graph event create failed:', detail);
    return "Failed to create follow-up calendar event";
  }

  //console.log('Checking the Response from Graph API for Event Creation:', await response.json());

  return "Follow-up calendar event successfully created";
}

export async function createLead(input: CreateLeadInput, options?: CreateLeadOptions): Promise<UiLead | { message: string; existingLead: UiLead }> {
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
    if (input.stage !== 'In Follow-up') {
      historyCreate.push({ action: "Lead created", detail: "Lead manually created", type: "SYSTEM", actionDate: new Date() });
    } else {
      historyCreate.push({ action: "Lead created with Follow-up Calender set", detail: "Lead manually created and Also Assign the Follow-up Calender", type: "SYSTEM", actionDate: new Date() });
    }
  }

  const normalizedEmail = (input.email ?? "").trim();
  const normalizedPhone = (input.phone ?? "").trim();

  const orConditions: Prisma.LeadWhereInput[] = [];
  if (normalizedEmail !== "") {
    orConditions.push({
      email: {
        equals: normalizedEmail,
        mode: Prisma.QueryMode.insensitive,
      },
    });
  }
  if (normalizedPhone !== "") {
    orConditions.push({ phone: normalizedPhone });
  }

  const duplicateLeadInclude = {
    history: { orderBy: { actionDate: "asc" } },
    chatSessions: true,
    assignedUser: { select: { id: true, name: true, email: true } },
    noteAnnotations: { orderBy: { createdAt: "desc" } },
  } satisfies Prisma.LeadInclude;

  const leadCreateResult = await prisma.$transaction(async (tx) => {
    const lockKeys = getLeadDedupeLockKeys(normalizedEmail, normalizedPhone);
    if (lockKeys.length > 0) {
      await lockLeadDedupeKeys(tx, lockKeys);

      const existingLead = await tx.lead.findFirst({
        where: { OR: orConditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: duplicateLeadInclude,
      });

      if (existingLead) {
        return { createdLead: null, existingLead };
      }
    }

    const createdLead = await tx.lead.create({
      data: {
        name: input.name,
        phone: normalizedPhone,
        email: normalizedEmail,
        location: input.location ?? "",
        source: input.source,
        sourceDetail: input.sourceDetail,
        stage: mappedStage,
        ...(input.assignedId ? { assignedUser: { connect: { id: input.assignedId } } } : {}),
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
      include: duplicateLeadInclude,
    });

    return { createdLead, existingLead: null };
  });

  if (leadCreateResult.existingLead) {
    return { message: "A lead with the same email or phone number already exists.", existingLead: mapLead(leadCreateResult.existingLead) };
  }

  const created = leadCreateResult.createdLead;
  const res = mapLead(created as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] } & { assignedUser: { id: string; name: string; email: string } | null });

  // ═══════════════════════════════════════════════════════
  // SEND NOTIFICATION TO NOVU ABOUT NEW LEAD
  // ═══════════════════════════════════════════════════════
  const notificationPayload = createNotification("leadCreated", {
    leadId: res.id.toString(),
    leadType: res.type,
    budget: res.budget ? (!isNaN(parseFloat(res.budget)) ? parseFloat(res.budget) : 0) : 0,
    location: res.location ?? "Not specified",
    customerName: res.name ?? "Not specified",
    customerEmail: res.email ?? "Not specified",
    customerPhone: res.phone ?? "Not specified"
  })
  await triggerNotification([], notificationPayload);
  // ═══════════════════════════════════════════════════════
  // SEND WELCOME EMAIL TO MANUALLY CREATED LEADS
  // ═══════════════════════════════════════════════════════
  if (!options?.skipWelcomeEmail && created.email && created.name && input.stage !== 'In Follow-up') {
    console.log(`[Lead ${created.id}] Sending welcome email to newly created lead...`);
    try {
      // 1. Map Prisma Lead to LeadPreview shape (converting null to undefined)
      const leadPreview = {
        id: created.id,
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
          body: htmlBody,
          cc: config.cc,
        });

        console.log(`[Lead ${created.id}] ✅ Welcome email successfully sent to ${created.email}`);
      } else {
        console.warn(`[Lead ${created.id}] ⚠️ Failed to render welcome email HTML. No email sent.`);
      }
    } catch (emailError) {
      console.error(`[Lead ${created.id}] ❌ Failed to send welcome email:`, emailError);
    }
  }

  return res
}

export async function updateLead(id: number, input: UpdateLeadInput): Promise<UiLead> {
  const mappedStage = input.stage ? stageToPrismaMap[input.stage] : undefined;
  const updateData: Prisma.LeadUpdateInput = {};

  if (input.name !== undefined) updateData.name = String(input.name);
  if (input.phone !== undefined) updateData.phone = input.phone ?? "";
  if (input.email !== undefined) updateData.email = input.email ?? "";
  if (input.location !== undefined) updateData.location = input.location ?? "";
  if (input.source !== undefined) updateData.source = input.source;
  if (input.sourceDetail !== undefined) updateData.sourceDetail = input.sourceDetail;
  if (input.stage !== undefined) updateData.stage = mappedStage;
  if (input.assignedId !== undefined) {
    const nextAssignedId = input.assignedId?.trim();
    updateData.assignedUser = nextAssignedId
      ? { connect: { id: nextAssignedId } }
      : { disconnect: true };
  }
  if (input.budget !== undefined) updateData.budget = input.budget;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.notesDoc !== undefined) updateData.notesDoc = input.notesDoc as Prisma.InputJsonValue;
  if (input.followupDate !== undefined) updateData.followupDate = input.followupDate;
  if (input.followupTime !== undefined) updateData.followupTime = input.followupTime;
  if (input.followupNotes !== undefined) updateData.followupNotes = input.followupNotes;
  if (input.lostReason !== undefined) updateData.lostReason = input.lostReason;
  if (input.urgent !== undefined) updateData.urgent = Boolean(input.urgent);

  const annotationInputs = input.annotationsToCreate ?? [];
  if (annotationInputs.length > 0) {
    updateData.noteAnnotations = {
      create: annotationInputs.map((annotation) => ({
        selectedText: annotation.selectedText,
        comment: annotation.comment,
        mentionedUserIds: annotation.mentionedUserIds,
      })),
    };
  }

  if ((input.history?.length ?? 0) > 0 || annotationInputs.length > 0) {
    const annotationHistory = annotationInputs.map((annotation) => {
      const now = new Date();
      return {
        action: "Lead note mention added",
        detail: annotation.comment || `Selected text: ${annotation.selectedText}`,
        type: "system" as const,
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().slice(0, 5),
      };
    });

    updateData.history = {
      create: [...(input.history ?? []), ...annotationHistory].map((h) => ({
        action: h.action,
        detail: h.detail || "",
        type: h.type ? (h.type.toUpperCase() as "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL") : "SYSTEM",
        actionDate: new Date(`${h.date}T${h.time || '00:00'}`),
      })),
    };
  }
  // console.log('checking the Input Data', input);
  // console.log('222Updating lead with data:', updateData);
  const existingLead = await prisma.lead.findUnique({ where: { id } });
  const updated = await prisma.lead.update({
    where: { id },
    data: updateData,
    include: { history: { orderBy: { actionDate: "asc" } }, chatSessions: true, assignedUser: { select: { id: true, name: true, email: true } }, noteAnnotations: { orderBy: { createdAt: "desc" } } },
  });

  for (const annotation of annotationInputs) {
    try {
      await sendLeadMentionEmails({
        leadId: id,
        leadName: updated.name,
        selectedText: annotation.selectedText,
        comment: annotation.comment,
        mentionedUserIds: annotation.mentionedUserIds,
      });
    } catch (error) {
      console.error(`[Lead ${id}] Failed to send annotation email`, error);
    }
  }

  const res = mapLead(updated as PrismaLead & { history: PrismaLeadHistory[] } & { chatSessions: ChatSession[] } & { assignedUser: { id: string; name: string; email: string } | null });
  if (input.assignedId === existingLead?.assignedId) {
    const notificationPayload = createNotification("leadUpdated", {
      leadId: res.id.toString(),
      leadType: res.type,
      location: res.location ?? "Not specified",
      customerName: res.name ?? "Not specified",
      customerEmail: res.email ?? "Not specified",
      customerPhone: res.phone ?? "Not specified",
      status: res.stage,
      change: mappedStage === existingLead?.stage ? "updated with more information" : undefined,
    })
    await triggerNotification(res.assignedId ? [res.assignedId] : [], notificationPayload);
  } else {
    if (res.assignedId) {
      const notificationPayload = createNotification("leadAssigned", {
        leadId: res.id.toString(),
        leadType: res.type,
        location: res.location ?? "Not specified",
        customerName: res.name ?? "Not specified",
        customerEmail: res.email ?? "Not specified",
        customerPhone: res.phone ?? "Not specified",
        assignedTo: res.assignedUser?.name ?? "Unknown",
      })
      await triggerNotification([res.assignedId], notificationPayload);
    }
  }

  return res;
}

export async function deleteLead(id: number) {
  await prisma.lead.delete({ where: { id } });
  return { success: true };
}

export async function getLeadsStats(): Promise<LeadsStats> {
  const [stats] = await prisma.$queryRaw<
    {
      total: bigint;
      new: bigint;
      contacted: bigint;
      qualified: bigint;
      quoted: bigint;
      won: bigint;
      lost: bigint;
      pendingFollowup: bigint;
    }[]
  >`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE stage = 'NEW') AS new,
      COUNT(*) FILTER (WHERE stage = 'CONTACTED') AS contacted,
      COUNT(*) FILTER (WHERE stage = 'QUALIFIED') AS qualified,
      COUNT(*) FILTER (WHERE stage = 'QUOTED') AS quoted,
      COUNT(*) FILTER (WHERE stage IN ('WON', 'CONVERTED')) AS won,
      COUNT(*) FILTER (WHERE stage IN ('LOST', 'CANCELLED', 'DISQUALIFIED')) AS lost,
      COUNT(*) FILTER (WHERE stage = 'IN_FOLLOW_UP') AS "pendingFollowup"
    FROM "Lead"
  `;

  return {
    total: Number(stats?.total ?? 0),
    new: Number(stats?.new ?? 0),
    contacted: Number(stats?.contacted ?? 0),
    qualified: Number(stats?.qualified ?? 0),
    quoted: Number(stats?.quoted ?? 0),
    conversion: Number(stats?.won ?? 0),
    pendingFollowup: Number(stats?.pendingFollowup ?? 0),
    lost: Number(stats?.lost ?? 0),
  };
}

export async function getAnalyticsData(): Promise<LeadAnalyticsData> {
  const [sourceRows, trendRows, lostReasonRows] = await Promise.all([
    prisma.$queryRaw<
      {
        source: string;
        total: bigint;
        won: bigint;
      }[]
    >`
    SELECT
      COALESCE(source, "sourceDetail", 'Website') AS source,
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE stage IN ('WON', 'CONVERTED')
      ) AS won
    FROM "Lead"
    GROUP BY COALESCE(source, "sourceDetail", 'Website')
    ORDER BY total DESC
  `,

    prisma.$queryRaw<
      {
        month: Date;
        leads: bigint;
        converted: bigint;
      }[]
    >`
    SELECT
      DATE_TRUNC('month', "createdAt") AS month,
      COUNT(*) AS leads,
      COUNT(*) FILTER (
        WHERE stage IN ('WON', 'CONVERTED')
      ) AS converted
    FROM "Lead"
    WHERE "createdAt" >= ${startOfMonth(subMonths(new Date(), 11))}
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `,

    prisma.$queryRaw<
      {
        name: string | null;
        value: bigint;
      }[]
    >`
    SELECT
      COALESCE("lostReason", 'Unknown') AS name,
      COUNT(*) AS value
    FROM "Lead"
    WHERE stage IN ('LOST', 'CANCELLED', 'DISQUALIFIED')
    GROUP BY COALESCE("lostReason", 'Unknown')
    ORDER BY value DESC
  `,
  ]);

  const sourceData = sourceRows.map((row) => ({
    name: row.source,
    value: Number(row.total),
  }));

  const conversionData = sourceRows.map((row) => ({
    source: row.source,
    total: Number(row.total),
    won: Number(row.won),
  }));

  const monthlyTrendMap = new Map(
    trendRows.map((row) => [
      format(new Date(row.month), "MMM"),
      {
        leads: Number(row.leads),
        converted: Number(row.converted),
      },
    ])
  );

  const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(startOfMonth(new Date()), 11 - i);
    const month = format(date, "MMM");

    return {
      month,
      leads: monthlyTrendMap.get(month)?.leads ?? 0,
      converted: monthlyTrendMap.get(month)?.converted ?? 0,
    };
  });

  const lostReasons = lostReasonRows.map((row) => ({
    name: row.name ?? "Unknown",
    value: Number(row.value),
  }));

  return {
    sourceData,
    conversionData,
    monthlyTrend,
    lostReasons,
  };
}
