import "server-only";
import { signBookConsultationToken } from "@/lib/leads/book-consultation-token";

import prisma from "@/lib/prisma";
import { mapLead, LeadAnalyticsData } from "@/types/lead";
import type { LeadStage } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import type { LeadsStats, Lead as UiLead } from "@/lib/leads/types";
import { fyQuarterOf, type FyQuarter } from "@/lib/leads/fy-quarter";
import { NEXT_FOLLOWUP_TASK } from "@/lib/leads/followup-resolution";
import {
  computeForecast,
  computePipelineMetrics,
  type ForecastResult,
  type LeadForMetrics,
  type PipelineMetrics,
} from "@/lib/leads/pipeline-math";
import { renderEmailHtml } from "../leads/render-email-html";
import { getGraphConfig } from "../graph/config";
import { createGraphContext } from "../graph/client";
import { Prisma, LeadEmails } from "@prisma/client";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
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
import { sendEmail } from "../azureClient";
import { generateEmailSubject } from "@/utils/generate-email-subject";
import {
  escapeEmailHtml,
  sendComposedLeadEmail,
} from "@/lib/leads/lead-email-send";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getUserByClerkIdCached } from "./user";
import {
  archiveLead as archiveLeadDomain,
  createLead as createLeadDomain,
  updateLead as updateLeadDomain,
} from "@/lib/domain/leads/commands";
import { currentLeadPrincipal } from "@/lib/data/current-principal";

const defaultLookupPageSize = 10; // Set to Infinity to fetch all leads without pagination

/**
 * Builds a deterministic set of advisory lock keys used to prevent duplicate
 * lead creation when multiple requests attempt to create the same lead
 * concurrently.
 *
 * A lock key is generated for the lead's email and phone (when provided),
 * sorted to ensure a consistent locking order and avoid deadlocks.
 *
 * @param email - Lead email address.
 * @param phone - Lead phone number.
 * @returns Sorted advisory lock keys.
 */
/**
 * Sends email notifications to users mentioned in a lead annotation.
 *
 * Each mentioned user receives an email containing the lead information,
 * selected note text, annotation comment, and a link to the CRM.
 *
 * Users without email addresses are ignored. Individual email failures are
 * logged without preventing delivery to other recipients.
 *
 * @param input - Mention notification payload.
 */
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
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL
    || "https://royal-construction-chi.vercel.app";
  const crmUrl = `${baseUrl}/leads`;
  const leadName = escapeEmailHtml(input.leadName);
  const selectedText = escapeEmailHtml(input.selectedText);
  const comment = escapeEmailHtml(input.comment);

  const recipients = users.filter((user) => user.email);
  if (recipients.length === 0) {
    console.warn(
      `[Lead ${input.leadId}] No email addresses found for mentioned users.`,
    );
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
    console.error(
      `[Lead ${input.leadId}] Failed to email ${failed.length} mentioned user(s).`,
      failed,
    );
  }
}

/**
 * Normalizes a search query by trimming surrounding whitespace.
 *
 * Returns an empty string when the value is undefined.
 *
 * @param search - Optional search query.
 * @returns Normalized search string.
 */
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

export interface FollowupStats {
  totalFollowUps: number;
  pendingFollowUps: number;
  upcomingFollowUps: number;
  totalMeetings: number;
  pendingMeetings: number;
  upcomingMeetings: number;
}

/**
 * Retrieves every lead in the system along with all related data required by
 * the UI and maps the database model into the frontend representation.
 *
 * @returns All mapped leads.
 * @throws {Error} If the leads cannot be retrieved.
 */
export async function getAllLeads(): Promise<UiLead[]> {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        history: { orderBy: { actionDate: "asc" }, include: { author: true } },
        chatSessions: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        noteAnnotations: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
        files: true,
        // The one task that decides the Follow-up cell. Not filtered to open
        // work: mapLead has to tell "the follow-up is done" apart from "this
        // lead never had one", and `where: { completedAt: null }` collapsed
        // both to an empty array. See NEXT_FOLLOWUP_TASK.
        tasks: NEXT_FOLLOWUP_TASK,
      },
    });
    return leads.map((lead) => mapLead(lead));
  } catch (error) {
    console.error("Error fetching all leads:", error);
    throw new Error("Failed to fetch leads");
  }
}

/**
 * Retrieves a paginated list of leads with optional search, stage filtering,
 * date-range filtering, and filtering for leads without an associated project.
 *
 * Supports filtering by:
 * - Lead stage(s)
 * - Search term (name, email, phone or location)
 * - Created date range relative to the Australia/Sydney timezone
 * - Leads without an associated project
 *
 * Results are ordered by newest first and include all related entities
 * required by the leads interface.
 *
 * @param page - 1-based page number.
 * @param limit - Maximum number of leads per page.
 * @param query - Optional search query.
 * @param status - Optional list of stages to filter by.
 * @param filterTiming - Optional predefined date range.
 * @param filterLeadsWithoutProject - Optional flag to filter leads that do not have an associated project.
 * @returns Paginated lead collection.
 */
export async function getLeads(
  page = 1,
  limit = defaultLookupPageSize,
  query?: string,
  status?: LeadStage[],
  filterTiming?: string,
  filterLeadsWithoutProject?: boolean,
  isArchived?: boolean,
  hasOpenTask?: boolean,
  pendingFollowUps?: boolean,
  upcomingFollowUps?: boolean,
  pendingMeetings?: boolean,
  upcomingMeetings?: boolean,
): Promise<PaginatedLeadsResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 50)
      : defaultLookupPageSize;
  const search = normalizeSearch(query);

  // 1. Determine if a timing filter should be active (skip if undefined or 'all')
  const hasTimingFilter = filterTiming && filterTiming !== "all";
  let timingFilter = {};
  const timeZone = "Australia/Sydney";

  // Current date in Sydney
  const sydneyNow = toZonedTime(new Date(), timeZone);
  const isMeetingScheduledFilterActive =
    pendingMeetings !== undefined
    || upcomingMeetings !== undefined
    || (status?.includes("MEETING_SCHEDULED") && status?.length === 1);

  if (hasTimingFilter) {
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

  const where: Prisma.LeadWhereInput | undefined =
    search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
            {
              location: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              secondaryName: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              secondaryEmail: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              secondaryPhone: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : undefined;
  try {
    const statusCleaned =
      status?.filter((s) => undefined !== s && s !== null) ?? null;
    const finalWhere: Prisma.LeadWhereInput = {
      ...where,
      ...(filterLeadsWithoutProject && {
        project: {
          is: null,
        },
      }),
      ...timingFilter,
      ...(statusCleaned && statusCleaned.length > 0
        ? { stage: { in: statusCleaned } }
        : {}),
      isArchived: isArchived ?? false,
      ...(pendingFollowUps !== undefined && {
        followupDate: {
          not: null,
          lte: fromZonedTime(startOfDay(sydneyNow), timeZone),
        },
      }),
      ...(upcomingFollowUps !== undefined && {
        followupDate: {
          not: null,
          gte: fromZonedTime(endOfDay(sydneyNow), timeZone),
        },
      }),
      // Leads carrying scheduled work. Replaces filtering the Follow-ups tab by
      // stage: a lead at Quoted or Negotiating can have a follow-up booked, and
      // the stage filter never returned it.
      // Nested under AND, not spread as bare `stage` and `OR` keys. `...where`
      // above already carries an OR for the search terms, and a second OR at
      // this level overwrites it in the object literal, so searching while the
      // Follow-ups tab was open would have silently ignored the search text.
      // Now keyed off the LeadTask table rather than the two date columns on
      // Lead, so this stays in step with what the Follow-ups tab lists. The
      // columns are still written for now and are dropped once nothing reads
      // them; the tasks are the source of truth from here.
      ...(hasOpenTask && {
        AND: [
          {
            stage: {
              notIn: [
                "CONVERTED",
                "WON",
                "LOST",
                "CANCELLED",
                "DISQUALIFIED",
              ] as LeadStage[],
            },
          },
          { tasks: { some: { completedAt: null } } },
        ],
      }),
      ...(isMeetingScheduledFilterActive && {
        meetingDate: {
          not: null,
        },
      }),
      ...(pendingMeetings !== undefined && {
        meetingDate: {
          not: null,
          lte: fromZonedTime(startOfDay(sydneyNow), timeZone),
        },
      }),
      ...(upcomingMeetings !== undefined && {
        meetingDate: {
          not: null,
          gte: fromZonedTime(endOfDay(sydneyNow), timeZone),
        },
      }),
    };
    const leads = await prisma.lead.findMany({
      where: finalWhere,
      include: {
        history: { orderBy: { actionDate: "asc" }, include: { author: true } },
        chatSessions: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        noteAnnotations: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
        files: true,
        // The one task that decides the Follow-up cell. Not filtered to open
        // work: mapLead has to tell "the follow-up is done" apart from "this
        // lead never had one", and `where: { completedAt: null }` collapsed
        // both to an empty array. See NEXT_FOLLOWUP_TASK.
        tasks: NEXT_FOLLOWUP_TASK,
      },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    const totalCount = await prisma.lead.count({
      where: finalWhere,
    });

    const items = leads.map((lead) => mapLead(lead));

    return {
      items,
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    };
  } catch (error) {
    // Rethrown rather than swallowed into an empty page: the lead pickers read
    // that as "no leads" and never said the load had failed. Both callers, the
    // /api/leads route and the MCP tool, catch it and report the failure.
    console.error("Error fetching leads:", error);
    throw error;
  }
}

type CreateLeadOptions = {
  skipWelcomeEmail?: boolean;
};

/**
 * Retrieves a single lead by its unique identifier.
 *
 * Includes history, annotations, emails, assigned user and chat sessions.
 *
 * @param id - Lead identifier.
 * @returns The mapped lead or null if not found.
 */
export async function findLeadById(id: number): Promise<UiLead | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      history: {
        orderBy: { actionDate: "asc" },
        include: { author: true },
      },
      chatSessions: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      noteAnnotations: { orderBy: { createdAt: "desc" } },
      emails: { orderBy: { createdAt: "desc" } },
      files: true,
      // mapLead cannot resolve a follow-up date without it, and omitting it
      // used to be silent: `tasks` was optional, so this query returned the
      // retired column even for a lead with a live open task.
      tasks: NEXT_FOLLOWUP_TASK,
    },
  });
  if (!lead) return null;
  return mapLead(lead);
}

/**
 * Retrieves a lead using its unique identifier.
 *
 * Includes all related entities required by the CRM UI.
 *
 * @param id - Lead identifier.
 * @returns The mapped lead or null if not found.
 *
 * @remarks
 * Despite its name, this function currently performs a lookup by lead ID
 * rather than by email address.
 */
export async function findLeadByEmail(id: number): Promise<UiLead | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      history: { orderBy: { actionDate: "asc" }, include: { author: true } },
      chatSessions: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      noteAnnotations: { orderBy: { createdAt: "desc" } },
      emails: { orderBy: { createdAt: "desc" } },
      files: true,
      // mapLead cannot resolve a follow-up date without it, and omitting it
      // used to be silent: `tasks` was optional, so this query returned the
      // retired column even for a lead with a live open task.
      tasks: NEXT_FOLLOWUP_TASK,
    },
  });
  if (!lead) return null;

  return mapLead(lead);
}

// export async function handleCalendarFollowup(
//   lead: Lead,
//   followupDate: string, // e.g., "2026-06-06"
//   followupTime: string  // e.g., "09:00" or "21:00"
// ): Promise<string | null> {

//   const config = getGraphConfig();
//   if (config.mode !== 'app-only' || !config.senderUpn) {
//     return "Graph API configuration is not set for app-only mode with a valid sender UPN.";
//   }

//   const credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
//   const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
//   const accessToken = tokenResult?.token;

//   if (!accessToken) throw new Error('Unable to acquire Graph access token');

//   // ─── 1. Date & Time Parsing & Formatting ─────────────────────────────

//   // Parse local start time (Assuming followupDate is YYYY-MM-DD and followupTime is HH:mm)
//   const startDateTime = new Date(`${followupDate}T${followupTime}:00`);

//   // Calculate end time locally (adds 1 hour, automatically handles day rollovers like 23:30 -> 00:30)
//   const endDateTimeObj = new Date(startDateTime.getTime() + 60 * 60 * 1000);

//   // Helper: Format Date object to Graph API accepted Local String "YYYY-MM-DDTHH:mm:ss"
//   const pad = (n: number) => n.toString().padStart(2, '0');
//   const formatToGraphDateTime = (d: Date) =>
//     `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

//   const graphStartStr = formatToGraphDateTime(startDateTime);
//   const graphEndStr = formatToGraphDateTime(endDateTimeObj);

//   // Helper: Format Date object to requested email display strings
//   const formatDisplayDate = (d: Date) =>
//     d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); // "Saturday 6 June 2026"

//   const formatDisplayTime = (d: Date) => {
//     const hours = d.getHours();
//     const minutes = d.getMinutes();
//     const ampm = hours >= 12 ? 'pm' : 'am';
//     const formattedHours = (hours % 12 || 12).toString().padStart(2, '0');
//     const formattedMinutes = minutes.toString().padStart(2, '0');
//     return `${formattedHours}:${formattedMinutes} ${ampm}`;
//   };

//   const displayDate = formatDisplayDate(startDateTime);
//   const displayTime = `${formatDisplayTime(startDateTime)} - ${formatDisplayTime(endDateTimeObj)} (AEST)`;

//   // ─── 2. Render React Email to HTML String ────────────────────────────

//   const emailHtml = await render(
//     FollowUpStageMeeting({
//       name: lead.name,
//       formattedDate: displayDate,
//       formattedTime: displayTime,

//     })
//   );

//   const attendees = [
//     {
//       emailAddress: { address: lead.email, name: lead.name },
//       type: 'required' // Main Lead
//     }
//   ];

//   // Add CC from .env if it exists (Graph API uses 'optional' type for CC)
//   const ccEmail = process.env.MAIL_ID_CC;
//   if (ccEmail) {
//     attendees.push({
//       emailAddress: { address: ccEmail, name: 'Admin' },
//       type: 'optional' // This acts as the CC in Outlook Calendar
//     });
//   }

//   // ─── 3. Construct Graph API Payload ──────────────────────────────────

//   const event = {
//     subject: `Follow-Up Calendar Event with ${lead.name} - Royal Constructions`,
//     body: {
//       contentType: 'HTML',
//       content: emailHtml, // Inject the beautifully styled React Email HTML
//     },
//     start: {
//       dateTime: graphStartStr,
//       timeZone: 'Australia/Sydney'
//     },
//     end: {
//       dateTime: graphEndStr,
//       timeZone: 'Australia/Sydney'
//     },
//     location: { displayName: 'Royal Constructions' },
//     attendees: attendees,
//   };

//   // ─── 4. Send Request to Graph API ────────────────────────────────────

//   const response = await fetch(
//     `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderUpn)}/events`,
//     {
//       method: 'POST',
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         'Content-Type': 'application/json',
//         // This header makes Graph return timezone properties in AEST in the response
//         'Prefer': 'outlook.timezone="Australia/Sydney"'
//       },
//       body: JSON.stringify(event),
//     }
//   );

//   if (!response.ok) {
//     const detail = await response.text();
//     console.error('Graph event create failed:', detail);
//     return "Failed to create follow-up calendar event";
//   }

//   //console.log('Checking the Response from Graph API for Event Creation:', await response.json());

//   return "Follow-up calendar event successfully created";
// }

/**
 * Creates a new lead while preventing duplicate creation using PostgreSQL
 * advisory locks and email/phone deduplication.
 *
 * A default history entry is automatically generated when one is not supplied.
 * If a duplicate lead already exists, the existing lead is returned instead of
 * creating a new record.
 *
 * After successful creation the function:
 * - Sends a lead created notification
 * - Optionally sends a welcome email
 *
 * @param input - Lead creation payload.
 * @param options - Optional creation behaviour flags.
 * @returns The newly created lead or the existing duplicate lead.
 */
export async function createLead(
  input: CreateLeadInput,
  options?: CreateLeadOptions,
): Promise<UiLead | { message: string; existingLead: UiLead }> {
  const outcome = await createLeadDomain(
    await currentLeadPrincipal(),
    input,
    prisma,
  );

  if (outcome.kind === "duplicate") {
    return {
      message: "A lead with the same email or phone number already exists.",
      existingLead: mapLead(outcome.existing),
    };
  }

  const created = outcome.lead;
  const res = mapLead(created);

  // Post-commit announcements. Neither is a business rule and neither may fail
  // the create: the lead exists either way, and a Novu or Graph outage must not
  // turn a captured enquiry into a 500 for a member of the public.
  const notificationPayload = createNotification("leadCreated", {
    leadId: res.id.toString(),
    leadType: res.type,
    budget: res.budget
      ? !isNaN(parseFloat(res.budget))
        ? parseFloat(res.budget)
        : 0
      : 0,
    location: res.location ?? "Not specified",
    customerName: res.name ?? "Not specified",
    customerEmail: res.email ?? "Not specified",
    customerPhone: res.phone ?? "Not specified",
  });
  await triggerNotification([], notificationPayload);

  if (
    !options?.skipWelcomeEmail
    && created.email
    && created.name
    && input.stage !== "In Follow-up"
  ) {
    await sendLeadWelcomeEmail(created);
  }

  return res;
}

/**
 * The welcome email a manually created lead receives.
 *
 * Adapter work end to end: rendering React Email, resolving Graph config, and
 * signing the booking token the template links to. It never throws — the lead
 * is already committed, and a mail failure is not a reason to report the
 * capture as failed.
 */
async function sendLeadWelcomeEmail(created: {
  id: number;
  name: string;
  email: string;
  type: string[];
  location: string | null;
  notes: string | null;
  budget: string | null;
}): Promise<void> {
  console.log(
    `[Lead ${created.id}] Sending welcome email to newly created lead...`,
  );
  try {
    const leadPreview = {
      id: created.id,
      name: created.name,
      email: created.email,
      type: created.type,
      location: created.location ?? undefined,
      notes: created.notes ?? undefined,
      budget: created.budget ?? undefined,
    };

    // Same reason as the inbound-lead workflow: createLead runs from the public
    // booking route and the lead webhook, neither of which has a Clerk session,
    // so renderEmailHtml would authorise and strip the token.
    const htmlBody = await renderEmailHtml(
      "Welcome",
      leadPreview,
      signBookConsultationToken(created.id),
    );

    if (!htmlBody) {
      console.warn(
        `[Lead ${created.id}] Failed to render welcome email HTML. No email sent.`,
      );
      return;
    }

    const config = getGraphConfig();
    const graphClient = await createGraphContext(config);
    await graphClient.sendMail({
      to: created.email,
      subject:
        "Welcome to Royal Constructions — Your Home Building Journey Starts Here",
      body: htmlBody,
      cc: config.cc,
    });
    console.log(
      `[Lead ${created.id}] Welcome email successfully sent to ${created.email}`,
    );
  } catch (emailError) {
    console.error(
      `[Lead ${created.id}] Failed to send welcome email:`,
      emailError,
    );
  }
}

/**
 * Updates an existing lead and all supported editable fields.
 *
 * Supports updating:
 * - Lead details
 * - Assignment
 * - Follow-up information
 * - Notes
 * - Rich note annotations
 * - History entries
 *
 * Mention notifications are sent for newly created annotations and lead
 * assignment/update notifications are dispatched when appropriate.
 *
 * @param id - Lead identifier.
 * @param input - Updated lead values.
 * @returns The updated lead.
 */
export async function updateLead(
  id: number,
  input: UpdateLeadInput,
): Promise<UiLead> {
  const outcome = await updateLeadDomain(
    await currentLeadPrincipal(),
    id,
    input,
    prisma,
  );

  // The offers list is cached per access scope (lib/data/offer-listing.ts), and
  // a user outside the internal roles sees only the leads assigned to them.
  // Left alone, a reassigned lead stayed on its old owner's list and off its
  // new owner's until the cache expired. The listing also shows the lead's
  // name, contact details, location and type, so an edit to one of those left
  // the old value on screen (and in search) just as long.
  //
  // revalidateTag rather than updateTag, because updateLead also runs from
  // Route Handlers (the lead PATCH, MCP and booking routes), where updateTag
  // throws. expire: 0 so nobody gets one more stale read of a list that decides
  // which offers they can see. The catch keeps a cache failure from failing the
  // save.
  if (input.assignedId !== undefined || outcome.listedFieldsChanged) {
    try {
      revalidateTag("offers", { expire: 0 });
    } catch (error) {
      console.error(
        `[Lead ${id}] Failed to expire the offers list cache`,
        error,
      );
    }
  }

  for (const annotation of input.annotationsToCreate ?? []) {
    try {
      await sendLeadMentionEmails({
        leadId: id,
        leadName: outcome.lead.name,
        selectedText: annotation.selectedText,
        comment: annotation.comment,
        mentionedUserIds: annotation.mentionedUserIds,
      });
    } catch (error) {
      console.error(`[Lead ${id}] Failed to send annotation email`, error);
    }
  }

  const res = mapLead(outcome.lead);

  // Which announcement to make is read off what the command reports it did.
  // Inferring it here by comparing `input.assignedId` with the stored value
  // told the assignee they had just been given the lead on every unrelated
  // edit, because an absent `assignedId` is `undefined` and never equals a
  // real id.
  if (outcome.assignmentChanged) {
    if (res.assignedId) {
      await triggerNotification(
        [res.assignedId],
        createNotification("leadAssigned", {
          leadId: res.id.toString(),
          leadType: res.type,
          location: res.location ?? "Not specified",
          customerName: res.name ?? "Not specified",
          customerEmail: res.email ?? "Not specified",
          customerPhone: res.phone ?? "Not specified",
          assignedTo: res.assignedUser?.name ?? "Unknown",
        }),
      );
    }
  } else {
    await triggerNotification(
      res.assignedId ? [res.assignedId] : [],
      createNotification("leadUpdated", {
        leadId: res.id.toString(),
        leadType: res.type,
        location: res.location ?? "Not specified",
        customerName: res.name ?? "Not specified",
        customerEmail: res.email ?? "Not specified",
        customerPhone: res.phone ?? "Not specified",
        status: res.stage,
        change: outcome.stageChanged
          ? undefined
          : "updated with more information",
      }),
    );
  }

  return res;
}

/**
 * Soft-deletes a lead by marking it as archived.
 *
 * This allows for potential recovery or auditing of leads without permanently removing them from the database.
 *
 * @param id - Lead identifier.
 * @returns Success status.
 */
export async function deleteLead(id: number) {
  await archiveLeadDomain(await currentLeadPrincipal(), id, prisma);
  return { success: true };
}

/**
 * Retrieves aggregate statistics for the lead pipeline.
 *
 * Counts are calculated directly in PostgreSQL using aggregate filters for
 * improved performance.
 *
 * @returns Summary statistics used by the leads dashboard.
 */
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
      -- Open tasks, counted from LeadTask.
      --
      -- This read Lead.followupDate and Lead.meetingDate, the columns the task
      -- table replaced. Nothing writes them any more, so the card was frozen at
      -- whatever the backfill left while the Tasks tab grew: 15 against 34 on
      -- staging, on the same screen. Every task created from here would have
      -- widened the gap.
      --
      -- Counted as TASKS, not leads. They coincide today because no lead holds
      -- two, but four task types exist precisely so a lead can have a call and
      -- a meeting at once.
      (
        SELECT COUNT(*) FROM "LeadTask" t
        JOIN "Lead" tl ON tl.id = t."leadId"
        WHERE t."completedAt" IS NULL
          AND tl."isArchived" = false
          AND tl.stage NOT IN ('CONVERTED', 'WON', 'LOST', 'CANCELLED', 'DISQUALIFIED')
      ) AS "pendingFollowup"
    FROM "Lead"
    WHERE "isArchived" = false
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

export async function getFollowupStats(): Promise<FollowupStats> {
  const timeZone = "Australia/Sydney";
  const sydneyNow = toZonedTime(new Date(), timeZone);
  const todayStart = startOfDay(sydneyNow);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const todayUTC = fromZonedTime(todayStart, timeZone);
  const tomorrowUTC = fromZonedTime(tomorrowStart, timeZone);

  // A Prisma.sql fragment, not a plain string: `${x}` in a $queryRaw template
  // becomes a bound parameter, so a bare string would be sent as a value and
  // the query would fail rather than filter.
  //
  // These counts used to key off stage IN ('IN_FOLLOW_UP', 'MEETING_SCHEDULED').
  // Scheduled work is a task now, so the filter is the date plus "not yet
  // completed", and the stage only decides whether the lead is still live at
  // all. Without this clause the 13 closed and won leads on production that
  // carry stale dates would count as outstanding work.
  const OPEN_STAGES = Prisma.sql`stage NOT IN ('CONVERTED', 'WON', 'LOST', 'CANCELLED', 'DISQUALIFIED')`;

  const [stats] = await prisma.$queryRaw<
    {
      totalFollowUps: bigint;
      pendingFollowUps: bigint;
      upcomingFollowUps: bigint;
      totalMeetings: bigint;
      pendingMeetings: bigint;
      upcomingMeetings: bigint;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE "followupDate" IS NOT NULL AND "followupCompletedAt" IS NULL AND ${OPEN_STAGES}) AS "totalFollowUps",
      COUNT(*) FILTER (WHERE "followupDate" IS NOT NULL AND "followupCompletedAt" IS NULL AND ${OPEN_STAGES} AND "followupDate" <= ${todayUTC}) AS "pendingFollowUps",
      COUNT(*) FILTER (WHERE "followupDate" IS NOT NULL AND "followupCompletedAt" IS NULL AND ${OPEN_STAGES} AND "followupDate" >= ${tomorrowUTC}) AS "upcomingFollowUps",
      COUNT(*) FILTER (WHERE "meetingDate" IS NOT NULL AND "meetingCompletedAt" IS NULL AND ${OPEN_STAGES}) AS "totalMeetings",
      COUNT(*) FILTER (WHERE "meetingDate" IS NOT NULL AND "meetingCompletedAt" IS NULL AND ${OPEN_STAGES} AND "meetingDate" < ${todayUTC}) AS "pendingMeetings",
      COUNT(*) FILTER (WHERE "meetingDate" IS NOT NULL AND "meetingCompletedAt" IS NULL AND ${OPEN_STAGES} AND "meetingDate" >= ${tomorrowUTC}) AS "upcomingMeetings"
    FROM "Lead"
    WHERE "isArchived" = false
  `;

  return {
    totalFollowUps: Number(stats?.totalFollowUps ?? 0),
    pendingFollowUps: Number(stats?.pendingFollowUps ?? 0),
    upcomingFollowUps: Number(stats?.upcomingFollowUps ?? 0),
    totalMeetings: Number(stats?.totalMeetings ?? 0),
    pendingMeetings: Number(stats?.pendingMeetings ?? 0),
    upcomingMeetings: Number(stats?.upcomingMeetings ?? 0),
  };
}

/**
 * Retrieves analytics datasets used throughout the CRM dashboard.
 *
 * Includes:
 * - Lead source distribution
 * - Conversion statistics by source
 * - Monthly lead trend for the past 12 months
 * - Lost lead reason distribution
 *
 * Aggregation is performed directly in PostgreSQL for efficiency.
 *
 * @returns Analytics datasets for chart rendering.
 */
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
    ]),
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

  const now = new Date();
  const leadsForMetrics = await fetchLeadsForMetrics();
  const current = fyQuarterOf(now);

  return {
    sourceData,
    conversionData,
    monthlyTrend,
    lostReasons,
    pipelineMetrics: serializeMetrics(
      computePipelineMetrics(leadsForMetrics, now),
    ),
    forecast: serializeForecast(
      computeForecast(leadsForMetrics, current.fy, current.quarter),
    ),
  };
}

/* ── Pipeline metrics & forecast ──────────────────────────────────────
 *
 * These MUST stay uncached. lib/data/leads.ts has no caching primitives and
 * must not gain any: under cacheComponents, a 'use cache' fetcher called in a
 * page body prefills at `next build` and fails CI with ETIMEDOUT.
 */

const PIPELINE_SELECT = {
  id: true,
  stage: true,
  estimatedValue: true,
  probabilityOverride: true,
  expectedCloseDate: true,
  wonAt: true,
  lostAt: true,
} as const;

async function fetchLeadsForMetrics(): Promise<LeadForMetrics[]> {
  // The isArchived filter matches every other lead aggregate in this file.
  // Soft-deleted leads are invisible everywhere else and must not inflate
  // pipeline value here.
  const rows = await prisma.lead.findMany({
    where: { isArchived: false },
    select: PIPELINE_SELECT,
  });
  return rows.map((row) => ({
    ...row,
    estimatedValue: row.estimatedValue?.toString() ?? null,
  }));
}

/** Decimal cannot cross to a Client Component — stringify at the boundary. */
function serializeMetrics(metrics: PipelineMetrics) {
  return {
    ...metrics,
    totalValue: metrics.totalValue.toString(),
    weightedValue: metrics.weightedValue.toString(),
    byStage: metrics.byStage.map((bucket) => ({
      ...bucket,
      total: bucket.total.toString(),
      weighted: bucket.weighted.toString(),
    })),
  };
}

function serializeForecast(forecast: ForecastResult) {
  return {
    ...forecast,
    expectedValue: forecast.expectedValue.toString(),
    weightedValue: forecast.weightedValue.toString(),
    wonValue: forecast.wonValue.toString(),
    bankedValue: forecast.bankedValue.toString(),
  };
}

export type SafePipelineMetrics = ReturnType<typeof serializeMetrics>;
export type SafeForecast = ReturnType<typeof serializeForecast>;

/** Forecast for an arbitrary FY quarter — backs the quarter selector. */
export async function getForecast(
  fy: number,
  quarter: FyQuarter,
): Promise<SafeForecast> {
  const leads = await fetchLeadsForMetrics();
  return serializeForecast(computeForecast(leads, fy, quarter));
}

/**
 * Sends an email to a lead and records the outgoing message in the lead's
 * email history.
 *
 * The email is delivered using the configured Graph email provider and a
 * deterministic checksum is generated to uniquely identify the stored email.
 *
 * @param leadId - Lead identifier.
 * @param subject - Email subject.
 * @param body - Email body.
 * @param to - Recipient email address.
 * @param replyingToEmail - The email being replied to, if any.
 * @returns The persisted email record.
 *
 * @throws {Error} If the lead does not exist or the email could not be sent.
 */
/**
 * The name that signs a lead email.
 *
 * Presentation, so it stays in the adapter. The fallback matters: a cron or a
 * webhook has nobody behind it, and "Royal Constructions" is a better
 * signature than a crash or an empty line.
 */
async function resolveSenderName(): Promise<string> {
  try {
    const { userId } = await auth();
    if (!userId) return "Royal Constructions";
    const user = await getUserByClerkIdCached(userId);
    return user?.name?.trim() || "Royal Constructions";
  } catch (error) {
    console.error("[Lead email] Could not resolve the sender name", error);
    return "Royal Constructions";
  }
}

export async function sendLeadEmail(
  leadId: number,
  location: string,
  body: string,
  to: string,
  replyingToEmail?: LeadEmails,
): Promise<LeadEmails> {
  try {
    // Composing, sending once and recording the thread is
    // lib/leads/lead-email-send.ts, which Eve's send_lead_email calls too.
    // The signature the client reads is presentation, so it stays here, and
    // the fallback matters: a cron or a webhook has no person behind it.
    const { email } = await sendComposedLeadEmail(
      await currentLeadPrincipal(),
      {
        body,
        leadId,
        location,
        replyingTo: replyingToEmail ?? null,
        senderName: await resolveSenderName(),
        to,
      },
      prisma,
      { generateSubject: generateEmailSubject, sendMail: sendEmail },
    );
    return email;
  } catch (error) {
    console.error(`[Lead ${leadId}] Failed to send email:`, error);
    throw new Error("Failed to send email");
  }
}
