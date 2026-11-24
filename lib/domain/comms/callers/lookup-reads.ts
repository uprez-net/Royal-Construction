import { InvoiceStatus, type LeadStage } from "@prisma/client";

import { sydneyMidnightIn, sydneyToday } from "@/lib/dates/sydney";

import type { DomainDb } from "../../db";
import {
  canSeeProjectFinancials,
  projectReadScope,
} from "../../access/projects";
import { searchOffers } from "../../offers/queries";
import type { EmbeddingPort } from "../../ports/embedding";
import { searchLeads } from "../../leads/queries";
import { getProjectFinancials } from "../../projects/financials";
import { listProjectsForLookup } from "../../projects/queries";
import type { UserPrincipal } from "../../principal";
import { toCents } from "../../tradies/billing-rules";
import { searchTradies } from "../../tradies/queries";
import { DEAD_BOOKINGS, milestoneLine } from "./briefing-lines";
import type { VoiceLookupResult, VoiceLookupWhen } from "./lookups";
import { resolveThroughIndex } from "./index-resolve";
import { projectSearchVariants } from "./project-search";
import { leadScopeWhere } from "./relationships";
import {
  addDays,
  bookingStatus,
  field,
  spokenDate,
  spokenDollars,
  staffLeadStage,
  staffProjectStatus,
  startOfSydneyDay,
} from "./speech";

// The reads behind the admin lookup catalogue (lookups.ts): one function per
// lookup, each built on the domain's own reads so the scope and the
// Admin-only financial rule (#158) are the app's. Each takes the re-checked
// staff principal; none is reachable except through runVoiceLookup.

/** An answer longer than this is cut. */
export const VOICE_LOOKUP_MAX_CHARS = 1_800;

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

type ProjectMatch = { id: string; name: string; location: string };

/** What a lookup may reach outside the database: the index's embeddings. */
export type VoiceLookupPorts = { readonly embedding?: EmbeddingPort };

/**
 * The caller's words → one project, or the reason there is not one. The words
 * are tried as said, then as the same address written other ways
 * (project-search.ts): the first search that finds a project still holding
 * the address the caller gave is the answer.
 */
async function oneProject(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  ports: VoiceLookupPorts = {},
): Promise<{ id: string; name: string } | VoiceLookupResult> {
  // The context index first (#621); every match is re-read live under the
  // caller's own project scope before it counts.
  const indexed = await resolveThroughIndex(
    principal,
    words,
    "project",
    db,
    ports,
  );
  if (indexed.kind !== "none") {
    const ids = indexed.kind === "one" ? [indexed.entityId] : indexed.entityIds;
    const live = await db.project.findMany({
      orderBy: { name: "asc" },
      select: { id: true, location: true, name: true },
      where: { id: { in: [...ids] }, ...projectReadScope(principal) },
    });
    if (live.length === 1) return live[0]!;
    if (live.length > 1) {
      return answer(
        [
          `${live.length} projects match "${field(words, 60)}"; ask which one:`,
          ...live.map((p) => `- ${field(p.name)} at ${field(p.location)}`),
        ],
        live.map((p) => `project:${p.id}`),
      );
    }
  }

  let found: { items: ProjectMatch[]; totalCount: number } | null = null;
  for (const search of projectSearchVariants(words)) {
    const page = await listProjectsForLookup(
      principal,
      { limit: 5, page: 1, query: search.query },
      db,
    );
    const { confirms } = search;
    if (confirms) {
      const items = page.items.filter((p) =>
        confirms(`${p.name} ${p.location}`),
      );
      found = { items, totalCount: items.length };
    } else {
      found = page;
    }
    if (found.items.length > 0) break;
  }
  if (!found || found.items.length === 0) {
    return answer(
      [
        `No project matches "${field(words, 60)}". Ask for the lot number or the suburb.`,
      ],
      [],
    );
  }
  if (found.items.length === 1) return found.items[0];
  return answer(
    [
      `${found.totalCount} projects match "${field(words, 60)}"; ask which one:`,
      ...found.items.map((p) => `- ${field(p.name)} at ${field(p.location)}`),
    ],
    found.items.map((p) => `project:${p.id}`),
  );
}

export async function projectStatus(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
  ports: VoiceLookupPorts = {},
): Promise<VoiceLookupResult> {
  const match = await oneProject(principal, words, db, ports);
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
      ...project.milestones.map((m) => `- ${milestoneLine(m, now)}.`),
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

export async function projectFinancials(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  ports: VoiceLookupPorts = {},
): Promise<VoiceLookupResult> {
  const match = await oneProject(principal, words, db, ports);
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

/**
 * The caller's words → the leads they could mean: the context index first
 * (#621), each re-read live under the caller's lead scope, then the scoped
 * name search.
 */
async function matchingLeads(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  ports: VoiceLookupPorts,
): Promise<{
  items: { id: number; name: string; location: string | null }[];
  totalCount: number;
}> {
  const indexed = await resolveThroughIndex(
    principal,
    words,
    "lead",
    db,
    ports,
  );
  if (indexed.kind !== "none") {
    const ids = (
      indexed.kind === "one" ? [indexed.entityId] : indexed.entityIds
    )
      .map(Number)
      .filter((id) => Number.isSafeInteger(id));
    const live = await db.lead.findMany({
      orderBy: { name: "asc" },
      select: { id: true, location: true, name: true },
      where: {
        id: { in: ids },
        isArchived: false,
        ...leadScopeWhere(principal),
      },
    });
    if (live.length) return { items: live, totalCount: live.length };
  }
  return searchLeads(
    principal,
    { includeArchived: false, limit: 5, page: 1, query: words },
    db,
  );
}

export async function leadSummary(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
  ports: VoiceLookupPorts = {},
): Promise<VoiceLookupResult> {
  const found = await matchingLeads(principal, words, db, ports);
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

/**
 * A lead's active offer, by the client's name, the site or the offer
 * reference in any form (#621): its status, when it went out, until when it
 * is valid, and its value only for a caller who may see money
 * (`canSeeProjectFinancials`).
 */
export async function offerStatus(
  principal: UserPrincipal,
  words: string,
  db: DomainDb,
  now: Date,
  ports: VoiceLookupPorts = {},
): Promise<VoiceLookupResult> {
  const indexed = await resolveThroughIndex(
    principal,
    words,
    "offer",
    db,
    ports,
  );
  let leadIds: number[];
  if (indexed.kind !== "none") {
    // An offer's index entry carries its lead's id.
    leadIds = (indexed.kind === "one" ? [indexed.entityId] : indexed.entityIds)
      .map(Number)
      .filter((id) => Number.isSafeInteger(id));
  } else {
    const found = await searchOffers(principal, { limit: 5, query: words }, db);
    leadIds = [
      ...new Set(found.filter((o) => o.isActive).map((o) => o.leadId)),
    ];
  }
  const offers = leadIds.length
    ? await db.offer.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          baseReference: true,
          contractValueIncGst: true,
          id: true,
          lead: { select: { location: true, name: true } },
          leadId: true,
          offerStatus: true,
          revisionNumber: true,
          sentAt: true,
          totalAmount: true,
          updatedAt: true,
        },
        take: 5,
        where: {
          isActive: true,
          lead: { isArchived: false, ...leadScopeWhere(principal) },
          leadId: { in: leadIds },
        },
      })
    : [];
  if (offers.length === 0) {
    return answer(
      [
        `No current offer matches "${field(words, 60)}". Ask for the client's name or the offer reference.`,
      ],
      [],
    );
  }
  const reference = (o: (typeof offers)[number]) =>
    `${o.baseReference.trim() || `OF-${o.leadId}`}-R${o.revisionNumber}`;
  if (offers.length > 1) {
    return answer(
      [
        `${offers.length} offers match "${field(words, 60)}"; ask which one:`,
        ...offers.map(
          (o) =>
            `- ${field(reference(o), 30)} for ${field(o.lead.name, 40)}${o.lead.location ? ` at ${field(o.lead.location, 40)}` : ""}`,
        ),
      ],
      offers.map((o) => `offer:${o.id}`),
    );
  }
  const offer = offers[0]!;
  const value = canSeeProjectFinancials(principal)
    ? toCents(offer.contractValueIncGst ?? offer.totalAmount)
    : null;
  return answer(
    [
      `${field(reference(offer), 30)} for ${field(offer.lead.name, 40)}${offer.lead.location ? ` at ${field(offer.lead.location, 40)}` : ""}: ${offer.offerStatus.toLowerCase().replaceAll("_", " ")}.`,
      offer.sentAt
        ? `Sent: ${spokenDate(offer.sentAt, now)}.`
        : "Not sent yet.",
      value === null ? "" : `Value: ${spokenDollars(value)} including GST.`,
      `Last changed: ${spokenDate(offer.updatedAt, now)}.`,
    ].filter(Boolean),
    [`offer:${offer.id}`],
  );
}

export async function tradieBookings(
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

/** Monday 00:00 in Sydney of the calendar week `weeks` after `now`'s. */
function sydneyWeekStart(now: Date, weeks: number): Date {
  // Monday = 0 … Sunday = 6, for `now`'s Sydney date.
  const weekday =
    (new Date(`${sydneyToday(now)}T00:00:00Z`).getUTCDay() + 6) % 7;
  return sydneyMidnightIn(weeks * 7 - weekday, now);
}

/** [from, to) for the period the caller named. Weeks run Monday to Sunday. */
function period(when: VoiceLookupWhen, now: Date): { from: Date; to: Date } {
  const today = startOfSydneyDay(now);
  switch (when) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 2) };
    case "this_week":
      return { from: sydneyWeekStart(now, 0), to: sydneyWeekStart(now, 1) };
    case "next_week":
      return { from: sydneyWeekStart(now, 1), to: sydneyWeekStart(now, 2) };
  }
}

export async function bookingsBetween(
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

export async function pipelineSummary(
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
