import "server-only";

import prisma from "@/lib/prisma";
import {
  sydneyDateOnly,
  sydneyTimeOnly,
  sydneyWallClockToInstant,
} from "@/lib/dates/sydney";
import {
  mapLead,
  stageToPrismaMap,
  historyTypeToPrisma,
  LeadAnalyticsData,
} from "@/types/lead";
import type { LeadStage } from "@prisma/client";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import { requiredLeadEmail } from "@/utils/validators";
import type { LeadsStats, Lead as UiLead } from "@/lib/leads/types";
import {
  closeDatePatch,
  isClosedUnsuccessful,
  stageDef,
} from "@/lib/leads/pipeline-stages";
import { resolveLeadStage } from "@/lib/leads/resolve-stage";
import { LeadValidationError } from "@/lib/leads/lead-validation-error";
import { fyQuarterOf, type FyQuarter } from "@/lib/leads/fy-quarter";
import { NEXT_FOLLOWUP_TASK } from "@/lib/leads/followup-resolution";
import {
  coerceMoney,
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
import { generateEmailChecksum } from "@/utils/generator";
import { generateEmailSubject } from "@/utils/generate-email-subject";
import { normalizeEmailAddress } from "@/utils/formatters";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { offerListingLeadChanged } from "@/lib/offer/offer-listing-query";
import { getUserByClerkIdCached } from "./user";
import { sanitizeLeadNotesHtml } from "@/lib/rich-text/lead-notes";
import { getAllEmailThreads } from "@/utils/email-parser";
import {
  EMAIL_FOOTER_HTML,
  EMAIL_HEADER_HTML,
} from "@/constants/email-artifacts";
import {
  buildFollowupConfirmedHistoryEntry,
  buildFollowupNotRequiredHistoryEntry,
  buildFollowupRescheduledHistoryEntry,
  buildMeetingDidNotTakePlaceHistoryEntry,
  buildMeetingReviewedHistoryEntry,
  buildStageChangedHistoryEntry,
} from "@/lib/leads/lead-helpers";
import { dropAlreadyRecorded } from "@/lib/leads/lead-history";
import { resolveActingUserId } from "@/lib/data/acting-user";

const defaultLookupPageSize = 10; // Set to Infinity to fetch all leads without pagination

function normalizeEmailBody(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function hasHtmlMarkup(value: string) {
  return /<[a-z][\s\S]*>/i.test(value);
}

function markdownToHtml(value: string) {
  const paragraphs = normalizeEmailBody(value)
    .split(/\n\s*\n/)
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs
    .map((paragraph) => {
      const formattedParagraph = paragraph
        .split("\n")
        .map((line) =>
          escapeEmailHtml(line).replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>",
          ),
        )
        .join("<br>");

      return `<p>${formattedParagraph}</p>`;
    })
    .join("");
}

function buildLeadEmailHtml(body: string, name: string) {
  const normalizedBody = normalizeEmailBody(body);
  const bodyHtml = hasHtmlMarkup(normalizedBody)
    ? sanitizeLeadNotesHtml(normalizedBody)
    : markdownToHtml(normalizedBody);

  return `${bodyHtml}<p style="margin:16px 0 0;">Thanks &amp; Regards, <br>${escapeEmailHtml(name)} <br>Royal Constructions.</p>`;
}

/**
 * Escapes HTML-sensitive characters to prevent HTML injection when embedding
 * user-provided values inside email templates.
 *
 * @param value - Raw string to escape.
 * @returns The escaped HTML-safe string.
 */
function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
function getLeadDedupeLockKeys(email: string, phone: string) {
  return [
    email === "" ? null : `lead:email:${email.toLowerCase()}`,
    phone === "" ? null : `lead:phone:${phone}`,
  ]
    .filter((key): key is string => key !== null)
    .sort();
}

/**
 * Acquires PostgreSQL transaction-scoped advisory locks for the provided
 * deduplication keys.
 *
 * Locks remain held until the surrounding transaction completes, ensuring
 * only one transaction can create a lead with the same identifying values.
 *
 * @param tx - Prisma transaction client.
 * @param keys - Advisory lock keys to acquire.
 */
async function lockLeadDedupeKeys(
  tx: Prisma.TransactionClient,
  keys: string[],
) {
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

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
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://royal-construction-chi.vercel.app";
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
    pendingMeetings !== undefined ||
    upcomingMeetings !== undefined ||
    (status?.includes("MEETING_SCHEDULED") && status?.length === 1);

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
  const stageValue = input.stage;
  const mappedStage = stageValue ? stageToPrismaMap[stageValue] : "NEW";
  const createdValue = coerceMoney(input.estimatedValue);
  const actingUserId = await resolveActingUserId();

  // Same rule updateLead enforces: a lead cannot sit in LOST/CANCELLED/
  // DISQUALIFIED without a recorded reason. Enforced here too because a lead
  // can be created directly in a closed stage — the add-lead modal does not
  // offer one, but the API and the MCP create tool both accept it.
  if (isClosedUnsuccessful(mappedStage) && !input.lostReason?.trim()) {
    throw new LeadValidationError(
      `Add a reason before creating a lead in ${stageDef(mappedStage).label}.`,
    );
  }

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
      ...(actingUserId ? { authorId: actingUserId } : {}),
    };
  });

  if (historyCreate.length === 0) {
    if (input.stage !== "In Follow-up") {
      historyCreate.push({
        action: "Lead created",
        detail: "Lead manually created",
        type: "SYSTEM",
        actionDate: new Date(),
        ...(actingUserId ? { authorId: actingUserId } : {}),
      });
    } else {
      historyCreate.push({
        action: "Lead created with Follow-up set",
        detail: "Lead manually created and Also Assign the Follow-up Stage",
        type: "SYSTEM",
        actionDate: new Date(),
        ...(actingUserId ? { authorId: actingUserId } : {}),
      });
    }
  }

  // Every lead needs a valid primary email (#110). createLeadSchema enforces it
  // for callers that parse it, but direct data-layer callers (the
  // consultation-booking route) only null-checked truthiness — a non-empty but
  // malformed address slipped straight through. Re-validate at the DB boundary
  // so EVERY path is covered, not just the schema-parsed ones.
  const emailCheck = requiredLeadEmail.safeParse(input.email);
  if (!emailCheck.success) {
    throw new Error(
      emailCheck.error.issues[0]?.message ?? "Enter a valid client email",
    );
  }
  const normalizedEmail = emailCheck.data;
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
    history: { orderBy: { actionDate: "asc" }, include: { author: true } },
    chatSessions: true,
    assignedUser: { select: { id: true, name: true, email: true } },
    noteAnnotations: { orderBy: { createdAt: "desc" } },
    emails: { orderBy: { createdAt: "desc" } },
    files: true,
    // Reused by BOTH create paths, and the dedupe branch returns an EXISTING
    // lead that may already carry open work — without this it was mapped to
    // its retired column.
    tasks: NEXT_FOLLOWUP_TASK,
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
        secondaryName: input.secondaryName,
        secondaryEmail: input.secondaryEmail,
        secondaryPhone: input.secondaryPhone,
        source: input.source,
        sourceDetail: input.sourceDetail,
        stage: mappedStage,
        ...(input.assignedId
          ? { assignedUser: { connect: { id: input.assignedId } } }
          : {}),
        budget: input.budget,
        // A lead created with a value is manually owned until an offer exists;
        // the offer sync then takes over only if the source is not MANUAL.
        // Both fields derive from ONE parse so they cannot disagree — keying
        // the source off the raw input instead would make a typed 0 set a
        // value while leaving the source null.
        estimatedValue: createdValue,
        estimatedValueSource: createdValue === null ? null : "MANUAL",
        expectedCloseDate: input.expectedCloseDate ?? null,
        // A lead created directly in a closed stage needs its close date
        // stamped, exactly as the two update paths do.
        ...closeDatePatch(null, mappedStage, new Date()),
        type: input.type ?? [],
        notes: input.notes,
        meetingDate: input.meetingDate,
        meetingTime: input.meetingTime,
        meetingMode: input.meetingMode,
        followupDate: input.followupDate,
        followupTime: input.followupTime,
        followupNotes: input.followupNotes,
        followupReminderSentAt: input.followupReminderSentAt,
        meetingReminderSentAt: input.meetingReminderSentAt,
        lostReason: input.lostReason,
        urgent: input.urgent ?? false,
        history: { create: historyCreate },
      },
      include: duplicateLeadInclude,
    });

    return { createdLead, existingLead: null };
  });

  if (leadCreateResult.existingLead) {
    return {
      message: "A lead with the same email or phone number already exists.",
      existingLead: mapLead(leadCreateResult.existingLead),
    };
  }

  const created = leadCreateResult.createdLead;
  const res = mapLead(created);

  // ═══════════════════════════════════════════════════════
  // SEND NOTIFICATION TO NOVU ABOUT NEW LEAD
  // ═══════════════════════════════════════════════════════
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
  // ═══════════════════════════════════════════════════════
  // SEND WELCOME EMAIL TO MANUALLY CREATED LEADS
  // ═══════════════════════════════════════════════════════
  if (
    !options?.skipWelcomeEmail &&
    created.email &&
    created.name &&
    input.stage !== "In Follow-up"
  ) {
    console.log(
      `[Lead ${created.id}] Sending welcome email to newly created lead...`,
    );
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
      const htmlBody = await renderEmailHtml("Welcome", leadPreview);

      if (htmlBody) {
        // 3. Initialize Graph Client
        const config = getGraphConfig();
        const graphClient = await createGraphContext(config);

        // 4. Define the subject line
        const emailSubject =
          "Welcome to Royal Constructions — Your Home Building Journey Starts Here";

        // 5. Send the email directly using the Graph Client
        await graphClient.sendMail({
          to: created.email,
          subject: emailSubject,
          body: htmlBody,
          cc: config.cc,
        });

        console.log(
          `[Lead ${created.id}] ✅ Welcome email successfully sent to ${created.email}`,
        );
      } else {
        console.warn(
          `[Lead ${created.id}] ⚠️ Failed to render welcome email HTML. No email sent.`,
        );
      }
    } catch (emailError) {
      console.error(
        `[Lead ${created.id}] ❌ Failed to send welcome email:`,
        emailError,
      );
    }
  }

  return res;
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
  const mappedStage = input.stage ? stageToPrismaMap[input.stage] : undefined;
  const updateData: Prisma.LeadUpdateInput = {};
  const actingUserId = await resolveActingUserId();

  // Read once, up front. Both the stage resolution below and the follow-up /
  // meeting branches need the current row, and this used to be two separate
  // findUnique calls that could disagree.
  //
  // History comes with it so the write below can tell a new entry from one the
  // caller has merely echoed back — see dropAlreadyRecorded.
  const existingLead = await prisma.lead.findUnique({
    where: { id },
    include: {
      history: { select: { action: true, detail: true, actionDate: true } },
    },
  });

  if (input.name !== undefined) updateData.name = String(input.name);
  if (input.phone !== undefined) updateData.phone = input.phone ?? "";
  if (input.email !== undefined) updateData.email = input.email ?? "";
  if (input.location !== undefined) updateData.location = input.location ?? "";
  if (input.secondaryName !== undefined)
    updateData.secondaryName = input.secondaryName;
  if (input.secondaryEmail !== undefined)
    updateData.secondaryEmail = input.secondaryEmail;
  if (input.secondaryPhone !== undefined)
    updateData.secondaryPhone = input.secondaryPhone;
  if (input.source !== undefined) updateData.source = input.source;
  if (input.sourceDetail !== undefined)
    updateData.sourceDetail = input.sourceDetail;
  // NOTE: `stage` is deliberately NOT written here. The follow-up branches
  // further down can also set it, so both inputs are resolved together after
  // them and stamped once — see the resolveLeadStage call below.
  if (input.assignedId !== undefined) {
    const nextAssignedId = input.assignedId?.trim();
    updateData.assignedUser = nextAssignedId
      ? { connect: { id: nextAssignedId } }
      : { disconnect: true };
  }
  if (input.budget !== undefined) updateData.budget = input.budget;
  // Deal economics. updateData is an explicit whitelist — new columns do not
  // flow through on their own.
  if (input.estimatedValue !== undefined) {
    // coerceMoney, not `new Prisma.Decimal(...)` — Decimal THROWS on a
    // non-numeric or whitespace-only string, which would reject the entire
    // lead update (name, stage, notes and all) with a 500 rather than a
    // field-level error. Zod rejects bad money at the API boundary; this is
    // defence in depth for the paths that do not go through it.
    updateData.estimatedValue = coerceMoney(input.estimatedValue);
  }
  if (input.estimatedValueSource !== undefined) {
    updateData.estimatedValueSource = input.estimatedValueSource;
  }
  if (input.probabilityOverride !== undefined) {
    updateData.probabilityOverride = input.probabilityOverride;
  }
  if (input.expectedCloseDate !== undefined) {
    updateData.expectedCloseDate = input.expectedCloseDate;
  }
  if (input.type !== undefined) updateData.type = input.type;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.notesDoc !== undefined)
    updateData.notesDoc = input.notesDoc as Prisma.InputJsonValue;
  // Setting a date reopens the task: a lead carries one meeting and one
  // follow-up at a time, so a fresh date must not inherit the last one's
  // completion stamp and show up already done.
  if (input.meetingDate !== undefined) {
    updateData.meetingDate = input.meetingDate;
    if (input.meetingDate !== null) updateData.meetingCompletedAt = null;
  }
  if (input.meetingTime !== undefined)
    updateData.meetingTime = input.meetingTime;
  if (input.meetingMode !== undefined)
    updateData.meetingMode = input.meetingMode;
  if (input.followupDate !== undefined) {
    updateData.followupDate = input.followupDate;
    if (input.followupDate !== null) updateData.followupCompletedAt = null;
  }
  if (input.followupTime !== undefined)
    updateData.followupTime = input.followupTime;
  if (input.followupNotes !== undefined)
    updateData.followupNotes = input.followupNotes;
  if (input.followupReminderSentAt !== undefined)
    updateData.followupReminderSentAt = input.followupReminderSentAt;
  if (input.meetingReminderSentAt !== undefined)
    updateData.meetingReminderSentAt = input.meetingReminderSentAt;
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

  // Answering a follow-up closes the task. It used to null the date and write
  // stage CONTACTED, and that stage write was the only record the software had
  // that a follow-up had finished. It also cost a lead in negotiation 50 points
  // for a call being answered. followupCompletedAt carries the fact now, and
  // the date is kept so the tab can still show what was scheduled.
  if (
    input.followupResponseOutcome === "yes" ||
    input.followupResponseOutcome === "notRequired"
  ) {
    updateData.followupCompletedAt = new Date();
    updateData.followupReminderSentAt = new Date();
  } else if (input.followupResponseOutcome === "reschedule") {
    const nextFollowupDate = new Date();
    nextFollowupDate.setDate(nextFollowupDate.getDate() + 1);
    updateData.followupDate = nextFollowupDate;
    updateData.followupTime =
      input.followupTime ?? existingLead?.followupTime ?? null;
    updateData.followupReminderSentAt = null;
    updateData.followupCompletedAt = null;
  }

  // Single stage write. `stage` and `followupResponseOutcome` are independently
  // optional on updateLeadSchema and both are exposed on the MCP surface, so
  // they can arrive together; resolveLeadStage decides which wins. The
  // close-date stamp is derived from the RESOLVED stage, never from the
  // requested one, so the stage column and wonAt/lostAt can never describe two
  // different transitions.
  // Scheduling work advances an early lead into Discovery and does nothing
  // else. Answering or clearing a task never moves the stage: that is the whole
  // point of the split, and it is why "yes" is absent from this condition.
  const taskScheduled =
    input.followupResponseOutcome === "reschedule" ||
    (input.followupDate !== undefined && input.followupDate !== null) ||
    (input.meetingDate !== undefined && input.meetingDate !== null);

  const resolvedStage = resolveLeadStage({
    currentStage: existingLead?.stage ?? null,
    requestedStage: mappedStage,
    taskScheduled,
  });
  if (resolvedStage !== undefined) {
    updateData.stage = resolvedStage;
    Object.assign(
      updateData,
      closeDatePatch(existingLead?.stage ?? null, resolvedStage, new Date()),
    );
  }

  // Pipeline movement is the most reportable thing a lead does and it was the
  // one operator action that left no trace: notes, emails, annotations and
  // follow-up outcomes all wrote history, a stage change wrote only the column
  // and a close date. Nothing could answer "when did this reach Quoted, and who
  // moved it" — including when a stale form silently moved it back.
  const stageHistory =
    resolvedStage !== undefined &&
    existingLead &&
    resolvedStage !== existingLead.stage
      ? [buildStageChangedHistoryEntry(existingLead.stage, resolvedStage)]
      : [];

  // Reason enforcement. This mirrors the modal's check, which was the ONLY
  // enforcement: the Zod schemas mark lostReason optional and nullable, so a
  // direct PATCH, the MCP tool or any server-side caller could strand a lead in
  // LOST/CANCELLED/DISQUALIFIED with no reason. Those rows land in the
  // "Unknown" slice of the non-conversion charts, invisible to anyone auditing
  // why work was lost.
  //
  // It fires on the two things this request can actually be blamed for:
  //   1. moving a lead INTO a closed-unsuccessful stage, and
  //   2. clearing the reason on a lead that is already in one.
  //
  // It deliberately does NOT fire on an unrelated edit to a lead that is
  // already closed with no reason. Those rows predate the rule — staging has
  // one today — and blocking every edit to them would make them permanently
  // uneditable, including the edit that would supply the missing reason.
  const effectiveStage = resolvedStage ?? existingLead?.stage;
  if (effectiveStage && isClosedUnsuccessful(effectiveStage)) {
    const enteringClosedStage =
      resolvedStage !== undefined &&
      !(existingLead && isClosedUnsuccessful(existingLead.stage));
    const clearingReason =
      input.lostReason !== undefined && !input.lostReason?.trim();

    if (enteringClosedStage || clearingReason) {
      const reason =
        input.lostReason !== undefined
          ? input.lostReason
          : existingLead?.lostReason;
      if (!reason?.trim()) {
        throw new LeadValidationError(
          `Add a reason before moving this lead to ${stageDef(effectiveStage).label}.`,
        );
      }
    }
  }

  if (input.meetingReviewOutcome === "no") {
    updateData.meetingReminderSentAt = new Date();
  } else if (input.meetingReviewOutcome === "yes") {
    updateData.meetingMode =
      input.meetingMode ?? existingLead?.meetingMode ?? null;
    updateData.meetingReminderSentAt = new Date();
  }

  if (
    (input.history?.length ?? 0) > 0 ||
    annotationInputs.length > 0 ||
    stageHistory.length > 0 ||
    input.followupResponseOutcome ||
    input.meetingReviewOutcome
  ) {
    const responseHistory =
      input.followupResponseOutcome === "yes"
        ? [buildFollowupConfirmedHistoryEntry()]
        : input.followupResponseOutcome === "notRequired"
          ? [buildFollowupNotRequiredHistoryEntry()]
          : input.followupResponseOutcome === "reschedule"
            ? [
                buildFollowupRescheduledHistoryEntry(
                  // Sydney, so the history line agrees with the date the operator
                  // picked rather than reading a day earlier all afternoon.
                  sydneyDateOnly(
                    (updateData.followupDate as Date | null | undefined) ??
                      existingLead?.followupDate ??
                      new Date(),
                  ),
                  String(
                    updateData.followupTime ?? existingLead?.followupTime ?? "",
                  ),
                ),
              ]
            : [];

    const meetingHistory =
      input.meetingReviewOutcome === "no"
        ? [buildMeetingDidNotTakePlaceHistoryEntry()]
        : input.meetingReviewOutcome === "yes"
          ? [
              buildMeetingReviewedHistoryEntry({
                meetingMode: String(
                  updateData.meetingMode ??
                    existingLead?.meetingMode ??
                    input.meetingMode ??
                    "Unknown",
                ),
                discussionNotes: String(input.discussionNotes ?? ""),
                buildScope: String(input.buildScope ?? ""),
              }),
            ]
          : [];

    const annotationHistory = annotationInputs.map((annotation) => {
      const now = new Date();
      return {
        action: "Lead note mention added",
        detail:
          annotation.comment || `Selected text: ${annotation.selectedText}`,
        type: "system" as const,
        date: sydneyDateOnly(now),
        time: sydneyTimeOnly(now),
      };
    });

    const toRow = (h: {
      action: string;
      detail?: string;
      type?: string;
      date: string;
      time?: string;
    }) => ({
      action: h.action,
      detail: h.detail || "",
      type: h.type
        ? (h.type.toUpperCase() as "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL")
        : "SYSTEM",
      // Sydney, not the server's zone. The pair was produced by
      // sydneyDateOnly/sydneyTimeOnly, and reading it back as UTC put every
      // entry ten hours in the future.
      actionDate: sydneyWallClockToInstant(h.date, h.time),
      ...(actingUserId ? { authorId: actingUserId } : {}),
    });

    // The echo guard applies to CALLER-SUPPLIED history only.
    //
    // That is the only input that can contain rows the lead already has: the
    // email modal and the booking route both handed the whole list back, so
    // every row was inserted a second time — one booking took a lead from four
    // activity entries to nine, and it compounded on the next. Those callers now
    // send only what is new; this keeps a caller that has not been updated from
    // duplicating it again.
    //
    // The entries built below it are generated fresh by this function and can
    // never be an echo, so they are NOT filtered — and must not be. Their
    // identity is action + detail + minute, and several of them are constant by
    // construction: every mention reads "Lead note mention added" /
    // "Mentioned in lead note", and a stage move repeated inside one minute
    // (Quoted → Negotiating, undone, redone) produces the same pair twice.
    // Filtering them dropped the later, real entry and left the feed asserting
    // the opposite of where the lead actually sits.
    const created = [
      ...dropAlreadyRecorded(
        (input.history ?? []).map(toRow),
        existingLead?.history ?? [],
      ),
      ...responseHistory.map(toRow),
      ...meetingHistory.map(toRow),
      ...annotationHistory.map(toRow),
      ...stageHistory.map(toRow),
    ];

    if (created.length > 0) {
      updateData.history = { create: created };
    }
  }
  // console.log('checking the Input Data', input);
  // console.log('222Updating lead with data:', updateData);
  // Hand the lead's outstanding work over IN THE SAME TRANSACTION as the lead
  // write. Split across two round trips, a failure on the second left the lead
  // showing a new owner while its open tasks still pointed at the old one and
  // still emailed them — which is the exact bug this reassignment exists to
  // fix, reintroduced in a narrower window.
  //
  // Only open tasks move: a completed task records who actually did the work.
  const reassignOpenTasks =
    input.assignedId !== undefined
      ? [
          prisma.leadTask.updateMany({
            where: { leadId: id, completedAt: null },
            data: { assignedId: input.assignedId?.trim() || null },
          }),
        ]
      : [];
  const listedFieldsChanged = offerListingLeadChanged(existingLead, updateData);

  const [updated] = await prisma.$transaction([
    prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        history: { orderBy: { actionDate: "asc" }, include: { author: true } },
        chatSessions: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        noteAnnotations: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
        files: true,
        // This result is the PATCH response body, and the detail page re-seeds
        // its edit form from it. Without the include every save handed the UI
        // back the retired column.
        tasks: NEXT_FOLLOWUP_TASK,
      },
    }),
    ...reassignOpenTasks,
  ]);

  // The offers list is cached per access scope (lib/data/offer-listing.ts), and
  // a user outside the internal roles sees only the leads assigned to them. Left
  // alone, a reassigned lead stayed on its old owner's list and off its new
  // owner's until the cache expired. The listing also shows the lead's name,
  // contact details, location and type, so an edit to one of those left the old
  // value on screen (and in search) just as long.
  //
  // The assignee side expires whenever an update SETS it, with no comparison
  // against the lead read before the transaction: a concurrent reassignment can
  // commit in between, which made that comparison skip an expiry it owed
  // (CodeRabbit, #246). The listed-field side compares what is about to be
  // stored, which no concurrent write can invalidate the same way.
  //
  // revalidateTag rather than updateTag, because updateLead also runs from Route
  // Handlers (the lead PATCH, MCP and booking routes), where updateTag throws.
  // expire: 0 so nobody gets one more stale read of a list that decides which
  // offers they can see. The catch keeps a cache failure from failing the save.
  if (input.assignedId !== undefined || listedFieldsChanged) {
    try {
      revalidateTag("offers", { expire: 0 });
    } catch (error) {
      console.error(
        `[Lead ${id}] Failed to expire the offers list cache`,
        error,
      );
    }
  }

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

  const res = mapLead(updated);
  if (input.assignedId === existingLead?.assignedId) {
    const notificationPayload = createNotification("leadUpdated", {
      leadId: res.id.toString(),
      leadType: res.type,
      location: res.location ?? "Not specified",
      customerName: res.name ?? "Not specified",
      customerEmail: res.email ?? "Not specified",
      customerPhone: res.phone ?? "Not specified",
      status: res.stage,
      change:
        mappedStage === existingLead?.stage
          ? "updated with more information"
          : undefined,
    });
    await triggerNotification(
      res.assignedId ? [res.assignedId] : [],
      notificationPayload,
    );
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
      });
      await triggerNotification([res.assignedId], notificationPayload);
    }
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
  await prisma.lead.update({ where: { id }, data: { isArchived: true } });
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
export async function sendLeadEmail(
  leadId: number,
  location: string,
  body: string,
  to: string,
  replyingToEmail?: LeadEmails,
): Promise<LeadEmails> {
  try {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("User not authenticated");
    }
    const user = await getUserByClerkIdCached(userId);
    if (!user) {
      throw new Error("Authenticated user not found");
    }
    const existingLead = await prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!existingLead) {
      throw new Error("Lead not found");
    }

    const signedBody = `
    <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; outline: none; }
    .rc-hover-toolbar {
      position: absolute;
      background: rgba(12,24,41,0.95);
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 9999;
      display: none;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      max-width: 90%;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .rc-hover-toolbar span { font-weight: 600; white-space: nowrap; }
    .rc-hover-toolbar input {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      font-size: 12px;
      width: 300px;
      max-width: 55vw;
      padding: 3px 8px;
      border-radius: 4px;
      outline: none;
      font-family: monospace;
    }
    .rc-hover-toolbar input:focus {
      border-color: #c6923a;
      background: rgba(255,255,255,0.15);
    }
  </style>
</head>
<body>
  <div style="background-color:#f7f6f2;margin:0;padding:0">
    ${EMAIL_HEADER_HTML}
    <p>Hi ${escapeEmailHtml(existingLead.name)},</p>
    ${buildLeadEmailHtml(body, user.name)}
    ${EMAIL_FOOTER_HTML}
  </div>
</body>
</html>
    `;

    // Generate a subject line using AI for the body
    const aiSubject = replyingToEmail
      ? `Re: ${replyingToEmail.subject}`
      : await generateEmailSubject(escapeEmailHtml(signedBody));
    await sendEmail({
      to,
      subject: replyingToEmail ? aiSubject : `${aiSubject} - ${location}`,
      body: signedBody,
    });
    const strippedEmailBody = getAllEmailThreads(signedBody, {
      from: normalizeEmailAddress(
        process.env.BUSINESS_EMAIL ?? "info@royalconstructions.com.au",
      ),
      to: normalizeEmailAddress(to),
      subject: `${aiSubject} - ${location}`,
      sentAt: format(new Date(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
    });
    let recordedEmail: LeadEmails | null = null;
    for (const thread of strippedEmailBody) {
      const checksum = await generateEmailChecksum(
        thread.subject,
        thread.body,
        normalizeEmailAddress(thread.from),
        normalizeEmailAddress(thread.to),
      );
      const emailRecord = await prisma.leadEmails.create({
        data: {
          leadId,
          subject: `${aiSubject} - ${location}`,
          body: thread.body,
          emailTo: normalizeEmailAddress(thread.to),
          emailFrom: normalizeEmailAddress(thread.from),
          checksum,
          sentAt: new Date(),
        },
      });
      console.log(
        `[Lead ${leadId}] Email sent and recorded with ID: ${emailRecord.id}`,
      );
      recordedEmail = emailRecord;
    }

    if (!recordedEmail) {
      throw new Error("Failed to record email");
    }

    return recordedEmail;
  } catch (error) {
    console.error(`[Lead ${leadId}] Failed to send email:`, error);
    throw new Error("Failed to send email");
  }
}
