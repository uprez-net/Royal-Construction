import {
  InvoiceStatus,
  TradieScheduleStatus,
  type LeadStage,
} from "@prisma/client";

import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import { projectReadScope } from "../../access/projects";
import { searchLeads } from "../../leads/queries";
import { getProjectFinancials } from "../../projects/financials";
import { listProjectsForLookup } from "../../projects/queries";
import type { UserPrincipal } from "../../principal";
import { toCents } from "../../tradies/billing-rules";
import { searchTradies } from "../../tradies/queries";
import { recordCallerAccess } from "./audit";
import type { VoiceCallerClass, VoiceCallerPrincipal } from "./identity";
import { currentVoiceStaff, leadScopeWhere } from "./relationships";
import {
  addDays,
  bookingStatus,
  field,
  milestoneStatus,
  spokenDate,
  spokenDollars,
  staffLeadStage,
  staffProjectStatus,
  startOfSydneyDay,
} from "./speech";

// The read-only questions a verified admin can ask Mili mid-call.
//
// GPT-Live cannot call tools, and its own delegation fires unreliably, so the
// call desk — which already reads the conversation after everything Mili says
// — is offered these as tools when (and only when) the caller is an ADMIN. It
// calls one; the server runs it here, under the caller's re-checked identity,
// and hands Mili the answer to read out.
//
// A catalogue, not a query language: each entry is one purpose-specific read
// with a bounded, speakable answer, built on the domain's own reads
// (`listProjectsForLookup`, `getProjectFinancials`, `searchLeads`,
// `searchTradies`) so the scope and the Admin-only financial rule (#158) are
// the app's, not a copy. Records are found by the words the caller used and
// resolved in the database — never by an id the model supplies. Nothing here
// writes, and nothing here reaches credentials, secrets or raw tables.

export type VoiceLookupWhen = "today" | "tomorrow" | "this_week" | "next_week";

export type VoiceLookupRequest =
  | { readonly name: "project_status"; readonly project: string }
  | { readonly name: "project_financials"; readonly project: string }
  | { readonly name: "lead_summary"; readonly lead: string }
  | { readonly name: "tradie_bookings"; readonly tradie: string }
  | { readonly name: "bookings_between"; readonly when: VoiceLookupWhen }
  | { readonly name: "pipeline_summary" };

export type VoiceLookupName = VoiceLookupRequest["name"];

export type VoiceLookupDefinition = {
  readonly name: VoiceLookupName;
  readonly description: string;
  /** JSON Schema for the call desk's tool. */
  readonly parameters: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
  /** Who may run it. Only admins today. */
  readonly classes: readonly VoiceCallerClass[];
};

const text = (description: string) => ({
  description,
  maxLength: 80,
  type: "string",
});

export const VOICE_LOOKUPS: readonly VoiceLookupDefinition[] = [
  {
    classes: ["admin"],
    description:
      "A project's status, stages in progress and coming up, site manager and the next trade bookings. Use when the caller asks how a job is going.",
    name: "project_status",
    parameters: {
      additionalProperties: false,
      properties: {
        project: text(
          "The project's name, client surname or suburb, as the caller said it.",
        ),
      },
      required: ["project"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A project's money: contract value, trade costs quoted and invoiced, forecast profit, and the client's progress claims paid and outstanding.",
    name: "project_financials",
    parameters: {
      additionalProperties: false,
      properties: {
        project: text(
          "The project's name, client surname or suburb, as the caller said it.",
        ),
      },
      required: ["project"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A lead's stage, who it is assigned to, its value and the next meeting or follow-up.",
    name: "lead_summary",
    parameters: {
      additionalProperties: false,
      properties: {
        lead: text("The lead's name or suburb, as the caller said it."),
      },
      required: ["lead"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description:
      "A tradie's trades, phone number and their bookings over the next month.",
    name: "tradie_bookings",
    parameters: {
      additionalProperties: false,
      properties: {
        tradie: text(
          "The tradie's name or business name, as the caller said it.",
        ),
      },
      required: ["tradie"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description: "Every trade booking for a period, across all projects.",
    name: "bookings_between",
    parameters: {
      additionalProperties: false,
      properties: {
        when: {
          enum: ["today", "tomorrow", "this_week", "next_week"],
          type: "string",
        },
      },
      required: ["when"],
      type: "object",
    },
  },
  {
    classes: ["admin"],
    description: "Open leads by stage, and how many came in this week.",
    name: "pipeline_summary",
    parameters: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    },
  },
];

/** The lookups this caller's class may run. Empty for everyone but admins. */
export function voiceLookupsFor(
  caller: VoiceCallerPrincipal,
): readonly VoiceLookupDefinition[] {
  return VOICE_LOOKUPS.filter((lookup) =>
    lookup.classes.includes(caller.identity.class),
  );
}

export type VoiceLookupResult = {
  /** What Mili may say: bounded, one fact per line. */
  readonly text: string;
  readonly recordIds: readonly string[];
};

/** An answer longer than this is cut. */
export const VOICE_LOOKUP_MAX_CHARS = 1_800;

const DEAD_BOOKINGS = [
  TradieScheduleStatus.CANCELLED,
  TradieScheduleStatus.DECLINED,
];

function answer(lines: readonly string[], recordIds: readonly string[]) {
  const joined = lines.join("\n");
  return {
    recordIds,
    text:
      joined.length <= VOICE_LOOKUP_MAX_CHARS
        ? joined
        : `${joined.slice(0, VOICE_LOOKUP_MAX_CHARS - 30).trimEnd()}\n(more on file)`,
  };
}

/** The caller's words → one project, or the reason there is not one. */
async function oneProject(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
): Promise<{ id: string; name: string } | VoiceLookupResult> {
  const found = await listProjectsForLookup(
    principal,
    { limit: 5, page: 1, query: words },
    db,
  );
  if (found.items.length === 1) return found.items[0];
  if (found.items.length === 0) {
    return answer([`No project matches "${field(words, 60)}".`], []);
  }
  return answer(
    [
      `${found.totalCount} projects match "${field(words, 60)}"; ask which one:`,
      ...found.items.map((p) => `- ${field(p.name)} at ${field(p.location)}`),
    ],
    found.items.map((p) => `project:${p.id}`),
  );
}

async function projectStatus(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
): Promise<VoiceLookupResult> {
  const match = await oneProject(principal, words, db);
  if ("text" in match) return match;
  const today = startOfSydneyDay(now);
  const project = await db.project.findFirstOrThrow({
    select: {
      id: true,
      location: true,
      milestones: {
        orderBy: { order: "asc" },
        select: { name: true, startDate: true, status: true, targetDate: true },
        where: { parentId: null, status: { in: ["ACTIVE", "PENDING"] } },
        take: 5,
      },
      name: true,
      siteManager: { select: { name: true } },
      status: true,
      tradieSchedules: {
        orderBy: { scheduledDate: "asc" },
        select: {
          id: true,
          scheduledDate: true,
          status: true,
          trade: true,
          tradie: { select: { name: true } },
        },
        take: 5,
        where: {
          scheduledDate: { gte: today },
          status: { notIn: DEAD_BOOKINGS },
        },
      },
    },
    where: { id: match.id, ...projectReadScope(principal) },
  });
  return answer(
    [
      `${field(project.name)} at ${field(project.location)}: ${staffProjectStatus(project.status)}.`,
      `Site manager: ${project.siteManager ? field(project.siteManager.name, 40) : "not assigned"}.`,
      ...project.milestones.map(
        (m) =>
          `- ${field(m.name)}: ${milestoneStatus(m.status)}; current schedule ${spokenDate(m.startDate, now) ?? "no start date"} to ${spokenDate(m.targetDate, now)}.`,
      ),
      project.tradieSchedules.length
        ? `Next bookings: ${project.tradieSchedules
            .map(
              (b) =>
                `${field(b.tradie.name, 40)}${b.trade ? ` (${field(b.trade, 30)})` : ""} ${spokenDate(b.scheduledDate, now)}, ${bookingStatus(b.status)}`,
            )
            .join("; ")}.`
        : "No upcoming trade bookings.",
    ],
    [
      `project:${project.id}`,
      ...project.tradieSchedules.map((b) => `booking:${b.id}`),
    ],
  );
}

async function projectFinancials(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
): Promise<VoiceLookupResult> {
  const match = await oneProject(principal, words, db);
  if ("text" in match) return match;
  // Admin-only, enforced by the app's own rule inside getProjectFinancials.
  const [financials, claims] = await Promise.all([
    getProjectFinancials(principal, { projectId: match.id }, db),
    db.invoice.findMany({
      select: { amountDue: true, amountPaid: true, id: true, total: true },
      where: {
        projectId: match.id,
        status: {
          in: [
            InvoiceStatus.AUTHORISED,
            InvoiceStatus.PAID,
            InvoiceStatus.SUBMITTED,
          ],
        },
      },
    }),
  ]);
  const totals = financials.totals;
  const claimed = claims.reduce((sum, c) => sum + toCents(c.total), 0);
  const paid = claims.reduce((sum, c) => sum + toCents(c.amountPaid), 0);
  const due = claims.reduce((sum, c) => sum + toCents(c.amountDue), 0);
  return answer(
    [
      `${field(match.name)} — figures ex GST unless said otherwise:`,
      `Contract value: ${spokenDollars(totals.tenderCents)}.`,
      `Trade costs quoted: ${spokenDollars(totals.quotedCents)}${totals.quoteMissing ? " (some bookings have no price yet)" : ""}; invoiced so far: ${spokenDollars(totals.invoicedCents)}.`,
      `Forecast profit: ${spokenDollars(totals.forecastProfitCents)}${totals.forecastPercent === null ? "" : ` (${Math.round(totals.forecastPercent)}%)`}.`,
      claims.length
        ? `Client progress claims (inc GST): ${claims.length} issued totalling ${spokenDollars(claimed)}; paid ${spokenDollars(paid)}; outstanding ${spokenDollars(due)}.`
        : "No client progress claims issued yet.",
    ],
    [`project:${match.id}`, ...claims.map((c) => `invoice:${c.id}`)],
  );
}

async function leadSummary(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
): Promise<VoiceLookupResult> {
  const found = await searchLeads(
    principal,
    { includeArchived: false, limit: 5, page: 1, query: words },
    db,
  );
  if (found.items.length === 0) {
    return answer([`No open lead matches "${field(words, 60)}".`], []);
  }
  if (found.items.length > 1) {
    return answer(
      [
        `${found.totalCount} leads match "${field(words, 60)}"; ask which one:`,
        ...found.items.map(
          (l) =>
            `- ${field(l.name, 40)}${l.location ? ` in ${field(l.location, 40)}` : ""}`,
        ),
      ],
      found.items.map((l) => `lead:${l.id}`),
    );
  }
  const lead = await db.lead.findFirstOrThrow({
    select: {
      assignedUser: { select: { name: true } },
      estimatedValue: true,
      followupCompletedAt: true,
      followupDate: true,
      followupTime: true,
      id: true,
      location: true,
      meetingCompletedAt: true,
      meetingDate: true,
      meetingTime: true,
      name: true,
      source: true,
      stage: true,
      type: true,
    },
    where: {
      id: found.items[0].id,
      ...leadScopeWhere(principal),
    },
  });
  const value =
    lead.estimatedValue === null ? null : toCents(lead.estimatedValue);
  return answer(
    [
      `${field(lead.name, 40)}${lead.location ? ` in ${field(lead.location, 40)}` : ""}: ${staffLeadStage(lead.stage)}.`,
      lead.type.length ? `Interested in: ${field(lead.type.join(", "))}.` : "",
      `Assigned to: ${lead.assignedUser ? field(lead.assignedUser.name, 40) : "nobody"}.`,
      value === null ? "" : `Estimated value: ${spokenDollars(value)}.`,
      lead.source ? `Source: ${field(lead.source, 40)}.` : "",
      lead.meetingDate && !lead.meetingCompletedAt
        ? `Meeting: ${spokenDate(lead.meetingDate, now)}${lead.meetingTime ? ` at ${field(lead.meetingTime, 10)}` : ""}.`
        : "",
      lead.followupDate && !lead.followupCompletedAt
        ? `Follow-up: ${spokenDate(lead.followupDate, now)}${lead.followupTime ? ` at ${field(lead.followupTime, 10)}` : ""}.`
        : "",
    ].filter(Boolean),
    [`lead:${lead.id}`],
  );
}

async function tradieBookings(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
): Promise<VoiceLookupResult> {
  const found = await searchTradies(
    principal,
    { favouriteOnly: false, limit: 5, query: words },
    db,
  );
  if (found.length === 0) {
    return answer([`No tradie matches "${field(words, 60)}".`], []);
  }
  if (found.length > 1) {
    return answer(
      [
        `Several tradies match "${field(words, 60)}"; ask which one:`,
        ...found.map((t) => `- ${field(t.name, 40)} (${field(t.trade, 30)})`),
      ],
      found.map((t) => `tradie:${t.id}`),
    );
  }
  const [tradie] = found;
  const today = startOfSydneyDay(now);
  const bookings = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      milestone: { select: { name: true } },
      project: { select: { name: true } },
      scheduledDate: true,
      status: true,
    },
    take: 8,
    where: {
      project: projectReadScope(principal),
      scheduledDate: { gte: today, lt: addDays(today, 31) },
      status: { notIn: DEAD_BOOKINGS },
      tradieId: tradie.id,
    },
  });
  return answer(
    [
      `${field(tradie.name, 40)}: ${field((tradie.trades.length ? tradie.trades : [tradie.trade]).join(", "))}. Phone ${field(tradie.phone, 20)}.`,
      bookings.length
        ? `Bookings in the next month: ${bookings
            .map(
              (b) =>
                `${spokenDate(b.scheduledDate, now)} at ${field(b.project.name, 50)}${b.milestone ? ` for ${field(b.milestone.name, 40)}` : ""}, ${bookingStatus(b.status)}`,
            )
            .join("; ")}.`
        : "No bookings in the next month.",
    ],
    [`tradie:${tradie.id}`, ...bookings.map((b) => `booking:${b.id}`)],
  );
}

function period(when: VoiceLookupWhen, now: Date): { from: Date; to: Date } {
  const today = startOfSydneyDay(now);
  switch (when) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 2) };
    case "this_week":
      return { from: today, to: addDays(today, 7) };
    case "next_week":
      return { from: addDays(today, 7), to: addDays(today, 14) };
  }
}

async function bookingsBetween(
  principal: UserPrincipal,
  when: VoiceLookupWhen,
  db: DomainDb,
  now: Date,
): Promise<VoiceLookupResult> {
  const { from, to } = period(when, now);
  const bookings = await db.tradieSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      project: { select: { name: true } },
      scheduledDate: true,
      status: true,
      trade: true,
      tradie: { select: { name: true } },
    },
    take: 15,
    where: {
      project: projectReadScope(principal),
      scheduledDate: { gte: from, lt: to },
      status: { notIn: DEAD_BOOKINGS },
    },
  });
  const label = when.replace("_", " ");
  return answer(
    bookings.length
      ? [
          `Trade bookings ${label}:`,
          ...bookings.map(
            (b) =>
              `- ${spokenDate(b.scheduledDate, now)}: ${field(b.tradie.name, 40)}${b.trade ? ` (${field(b.trade, 30)})` : ""} at ${field(b.project.name, 50)}, ${bookingStatus(b.status)}.`,
          ),
        ]
      : [`No trade bookings ${label}.`],
    bookings.map((b) => `booking:${b.id}`),
  );
}

async function pipelineSummary(
  principal: UserPrincipal,
  db: DomainDb,
  now: Date,
): Promise<VoiceLookupResult> {
  const [pipeline, newThisWeek] = await Promise.all([
    searchLeads(
      principal,
      { includeArchived: false, limit: 1, page: 1, query: "" },
      db,
    ),
    db.lead.count({
      where: {
        createdAt: { gte: addDays(startOfSydneyDay(now), -7) },
        isArchived: false,
        ...leadScopeWhere(principal),
      },
    }),
  ]);
  const stages = Object.entries(pipeline.countsByStage)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([stage, count]) => `${staffLeadStage(stage as LeadStage)}: ${count}`);
  return answer(
    [
      `Open leads: ${pipeline.totalCount}. New in the last seven days: ${newThisWeek}.`,
      ...(stages.length ? [`By stage — ${stages.join("; ")}.`] : []),
    ],
    [],
  );
}

/**
 * Run one catalogue lookup for this caller.
 *
 * Refuses — and audits the refusal — when the caller's class may not run it;
 * re-checks the caller's identity on every call; audits the record ids it
 * read before returning. Throws on refusal or failure: the adapter tells Mili
 * she could not check, never that something was found.
 */
export async function runVoiceLookup(
  caller: VoiceCallerPrincipal,
  request: VoiceLookupRequest,
  db: DomainDb,
  input: { readonly now: Date },
): Promise<VoiceLookupResult> {
  const allowed = voiceLookupsFor(caller).some(
    (lookup) => lookup.name === request.name,
  );
  if (!allowed) {
    await recordCallerAccess(
      caller,
      { kind: "REFUSED", outcome: "not_permitted", queryName: request.name },
      db,
    );
    throw new DomainAuthorizationError(
      "That lookup is not available to this caller.",
    );
  }
  let principal: UserPrincipal;
  try {
    principal = await currentVoiceStaff(caller, db);
  } catch (error) {
    await recordCallerAccess(
      caller,
      { kind: "REFUSED", outcome: "identity_changed", queryName: request.name },
      db,
    );
    throw error;
  }
  const { now } = input;
  const result =
    request.name === "project_status"
      ? await projectStatus(principal, request.project, db, now)
      : request.name === "project_financials"
        ? await projectFinancials(principal, request.project, db)
        : request.name === "lead_summary"
          ? await leadSummary(principal, request.lead, db, now)
          : request.name === "tradie_bookings"
            ? await tradieBookings(principal, request.tradie, db, now)
            : request.name === "bookings_between"
              ? await bookingsBetween(principal, request.when, db, now)
              : await pipelineSummary(principal, db, now);
  await recordCallerAccess(
    caller,
    {
      kind: "LOOKUP",
      outcome: "ok",
      queryName: request.name,
      recordIds: result.recordIds,
    },
    db,
  );
  return result;
}
