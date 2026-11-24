import type { Prisma } from "@prisma/client";
import { sydneyStartOfDay, sydneyToday } from "@/lib/dates/sydney";
import {
  meetingsBetweenWhere,
  overdueLeadTaskWhere,
} from "@/lib/leads/followup-due";
import type { DomainDb } from "../db";
import { OFFER_AWAITING_SIGNATURE_STATUSES } from "../offers/office-list";
import { projectInProgressWhere } from "../projects/milestones-due";
import {
  leadSections,
  offerSections,
  officeDigestChunk,
  projectSections,
  tradieChunk,
  type ChunkDraft,
  type OfficeDigestSource,
} from "./text";

// Reads the CRM and lays it out with ./text. Kept apart from the builders so
// the wording can be tested without a database and the queries without caring
// about the wording.

/** Closed deals stay in the index this long after they last changed. */
export const RECENTLY_CLOSED_DAYS = 60;
/**
 * Stages whose leads drop out of the search index RECENTLY_CLOSED_DAYS after
 * they last changed.
 *
 * Not the "closed lead" rule for work lists. A won or converted lead stays
 * searchable because the office still talks about it ("the Sandhu job"), while
 * a lead that went quiet does not need to be found months later. Whether a
 * lead's tasks and meetings count as live work is LIVE_LEAD's decision
 * (lib/leads/followup-due.ts), used by the digest below.
 */
const INDEX_EXPIRING_STAGES = [
  "LOST",
  "CANCELLED",
  "DISQUALIFIED",
  "NO_RESPONSE",
] as const;
const RECENT_HISTORY = 4;
const OPEN_TASKS = 5;
const UPCOMING_BOOKINGS = 6;

/** Which records a refresh covers. Omitted lists mean "every live record". */
export type ContextSelection = {
  readonly leadIds?: readonly number[];
  readonly projectIds?: readonly string[];
  readonly tradieIds?: readonly string[];
};

function num(value: Prisma.Decimal | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function recentCutoff(now: Date) {
  return new Date(now.getTime() - RECENTLY_CLOSED_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The leads the index holds. One rule for the record snapshots and for the
 * documents filed under them (./file-sources.ts).
 */
export function liveLeadWhere(now: Date): Prisma.LeadWhereInput {
  return {
    isArchived: false,
    OR: [
      { stage: { notIn: [...INDEX_EXPIRING_STAGES] } },
      { updatedAt: { gte: recentCutoff(now) } },
    ],
  };
}

/** The projects the index holds; see liveLeadWhere. */
export function liveProjectWhere(now: Date): Prisma.ProjectWhereInput {
  return {
    OR: [
      { status: { not: "COMPLETED" } },
      { updatedAt: { gte: recentCutoff(now) } },
    ],
  };
}

export async function loadLeadChunks(
  db: DomainDb,
  now: Date,
  leadIds?: readonly number[],
): Promise<ChunkDraft[]> {
  const leads = await db.lead.findMany({
    where: leadIds
      ? { id: { in: [...leadIds] }, isArchived: false }
      : liveLeadWhere(now),
    orderBy: { id: "asc" },
    select: {
      assignedUser: { select: { name: true } },
      budget: true,
      estimatedStartDate: true,
      estimatedValue: true,
      expectedCloseDate: true,
      followupDate: true,
      followupTime: true,
      history: {
        orderBy: { actionDate: "desc" },
        select: { action: true, actionDate: true, detail: true, type: true },
        take: RECENT_HISTORY,
      },
      id: true,
      location: true,
      lostReason: true,
      meetingDate: true,
      meetingMode: true,
      meetingTime: true,
      name: true,
      offers: {
        select: {
          baseReference: true,
          contractValueIncGst: true,
          id: true,
          offerStatus: true,
          revisionNumber: true,
          sentAt: true,
          totalAmount: true,
          updatedAt: true,
        },
        take: 1,
        where: { isActive: true },
      },
      project: { select: { id: true, name: true, status: true } },
      secondaryName: true,
      source: true,
      stage: true,
      tasks: {
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        select: { dueDate: true, dueTime: true, notes: true, type: true },
        take: OPEN_TASKS,
        where: { status: { not: "DONE" } },
      },
      type: true,
      updatedAt: true,
      urgent: true,
    },
  });

  return leads.flatMap((lead) => {
    const offer = lead.offers[0];
    return leadSections({
      activeOffer: offer
        ? {
            contractValueIncGst: num(offer.contractValueIncGst),
            id: offer.id,
            reference: offer.baseReference.trim() || `OF-${lead.id}`,
            revisionNumber: offer.revisionNumber,
            sentAt: offer.sentAt,
            status: offer.offerStatus,
            totalAmount: Number(offer.totalAmount),
            updatedAt: offer.updatedAt,
          }
        : null,
      assignedName: lead.assignedUser?.name ?? null,
      budget: lead.budget,
      estimatedStartDate: lead.estimatedStartDate,
      estimatedValue: num(lead.estimatedValue),
      expectedCloseDate: lead.expectedCloseDate,
      followupDate: lead.followupDate,
      followupTime: lead.followupTime,
      id: lead.id,
      location: lead.location,
      lostReason: lead.lostReason,
      meetingDate: lead.meetingDate,
      meetingMode: lead.meetingMode,
      meetingTime: lead.meetingTime,
      name: lead.name,
      openTasks: lead.tasks,
      project: lead.project,
      recentHistory: lead.history,
      secondaryName: lead.secondaryName,
      source: lead.source,
      stage: lead.stage,
      type: lead.type,
      updatedAt: lead.updatedAt,
      urgent: lead.urgent,
    });
  });
}

export async function loadProjectChunks(
  db: DomainDb,
  now: Date,
  projectIds?: readonly string[],
): Promise<ChunkDraft[]> {
  const projects = await db.project.findMany({
    where: projectIds ? { id: { in: [...projectIds] } } : liveProjectWhere(now),
    orderBy: { id: "asc" },
    select: {
      buildingType: true,
      certifierEngagement: {
        select: {
          alerts: { select: { type: true }, where: { status: "OPEN" } },
          certifierName: true,
          status: true,
        },
      },
      checklists: {
        orderBy: { number: "asc" },
        select: { status: true, title: true },
      },
      council: true,
      customer: { select: { name: true } },
      customers: {
        orderBy: { position: "asc" },
        select: { customer: { select: { name: true } } },
      },
      estimatedEndDate: true,
      id: true,
      invoices: {
        orderBy: { issuedDate: "asc" },
        select: {
          amountDue: true,
          projectStage: true,
          status: true,
          total: true,
        },
        // A draft is not a claim the client has been sent.
        where: { status: { notIn: ["DRAFT", "VOIDED", "DELETED"] } },
      },
      leadId: true,
      location: true,
      milestones: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          parentId: true,
          projectStage: true,
          startDate: true,
          status: true,
          targetDate: true,
        },
      },
      name: true,
      siteManager: { select: { name: true } },
      spent: true,
      startDate: true,
      status: true,
      totalBudget: true,
      tradieSchedules: {
        orderBy: { scheduledDate: "asc" },
        select: {
          durationDays: true,
          scheduledDate: true,
          status: true,
          trade: true,
          tradie: { select: { name: true } },
        },
        take: UPCOMING_BOOKINGS,
        where: {
          scheduledDate: { gte: now },
          status: { notIn: ["CANCELLED", "DECLINED", "COMPLETED"] },
        },
      },
      variations: { select: { id: true }, where: { status: "PENDING" } },
    },
  });

  return projects.flatMap((project) => {
    const customerNames = project.customers.length
      ? project.customers.map((entry) => entry.customer.name)
      : [project.customer.name];
    return projectSections({
      buildingType: project.buildingType,
      checklists: project.checklists,
      compliance: project.certifierEngagement
        ? {
            certifierName: project.certifierEngagement.certifierName,
            openAlerts: project.certifierEngagement.alerts.map((a) => a.type),
            status: project.certifierEngagement.status,
          }
        : null,
      council: project.council,
      customerNames,
      estimatedEndDate: project.estimatedEndDate,
      id: project.id,
      invoices: project.invoices.map((inv) => ({
        amountDue: Number(inv.amountDue),
        projectStage: inv.projectStage,
        status: inv.status,
        total: Number(inv.total),
      })),
      leadId: project.leadId,
      location: project.location,
      milestones: project.milestones.map((m) => ({
        isTopLevel: m.parentId === null,
        name: m.name,
        projectStage: m.projectStage,
        startDate: m.startDate,
        status: m.status,
        targetDate: m.targetDate,
      })),
      name: project.name,
      openVariations: project.variations.length,
      siteManagerName: project.siteManager?.name ?? null,
      spent: Number(project.spent),
      startDate: project.startDate,
      status: project.status,
      totalBudget: Number(project.totalBudget),
      upcomingBookings: project.tradieSchedules.map((b) => ({
        durationDays: b.durationDays,
        scheduledDate: b.scheduledDate,
        status: b.status,
        trade: b.trade,
        tradieName: b.tradie.name,
      })),
    });
  });
}

/** `job.validUntil` from an offer's workspace, when it is a calendar date. */
function workspaceValidUntil(workspaceState: unknown): string | null {
  if (!workspaceState || typeof workspaceState !== "object") return null;
  const job = (workspaceState as { job?: { validUntil?: unknown } }).job;
  const value = job?.validUntil;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

/**
 * Each live lead's active offer, as a record of its own (#621). Keyed by the
 * lead's id, so the same rows are refreshed with the lead and a new revision
 * replaces the old one in place.
 */
export async function loadOfferChunks(
  db: DomainDb,
  now: Date,
  leadIds?: readonly number[],
): Promise<ChunkDraft[]> {
  const offers = await db.offer.findMany({
    orderBy: { leadId: "asc" },
    select: {
      _count: { select: { followUps: true } },
      acceptedAt: true,
      baseReference: true,
      contractValueIncGst: true,
      followUps: {
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
        take: 1,
      },
      id: true,
      lead: {
        select: {
          location: true,
          name: true,
          project: { select: { id: true } },
          secondaryName: true,
        },
      },
      leadId: true,
      offerStatus: true,
      revisionNumber: true,
      sentAt: true,
      totalAmount: true,
      updatedAt: true,
      workspaceState: true,
    },
    where: {
      isActive: true,
      lead: leadIds
        ? { id: { in: [...leadIds] }, isArchived: false }
        : liveLeadWhere(now),
    },
  });

  return offers.flatMap((offer) =>
    offerSections({
      acceptedAt: offer.acceptedAt,
      followUps: {
        count: offer._count.followUps,
        lastSentAt: offer.followUps[0]?.sentAt ?? null,
      },
      id: offer.id,
      leadId: offer.leadId,
      leadName: offer.lead.name,
      location: offer.lead.location,
      projectId: offer.lead.project?.id ?? null,
      reference: offer.baseReference.trim() || `OF-${offer.leadId}`,
      revisionNumber: offer.revisionNumber,
      secondaryName: offer.lead.secondaryName,
      sentAt: offer.sentAt,
      status: offer.offerStatus,
      totalAmount: Number(offer.totalAmount),
      updatedAt: offer.updatedAt,
      validUntil: workspaceValidUntil(offer.workspaceState),
      valueIncGst: num(offer.contractValueIncGst),
    }),
  );
}

export async function loadTradieChunks(
  db: DomainDb,
  now: Date,
  tradieIds?: readonly string[],
): Promise<ChunkDraft[]> {
  const tradies = await db.tradie.findMany({
    where: tradieIds
      ? { archivedAt: null, id: { in: [...tradieIds] } }
      : { archivedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      incidents: { select: { id: true }, where: { status: "OPEN" } },
      isFavourite: true,
      lastQuotedPrice: true,
      lastQuotedPriceUnit: true,
      location: true,
      name: true,
      rating: true,
      schedules: {
        orderBy: { scheduledDate: "asc" },
        select: {
          project: { select: { name: true } },
          scheduledDate: true,
          status: true,
        },
        take: UPCOMING_BOOKINGS,
        where: {
          scheduledDate: { gte: now },
          status: { notIn: ["CANCELLED", "DECLINED", "COMPLETED"] },
        },
      },
      trade: true,
      trades: true,
    },
  });

  return tradies.map((tradie) =>
    tradieChunk({
      id: tradie.id,
      isFavourite: tradie.isFavourite,
      lastQuotedPrice: num(tradie.lastQuotedPrice),
      lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
      location: tradie.location,
      name: tradie.name,
      openIncidents: tradie.incidents.length,
      rating: num(tradie.rating),
      trade: tradie.trade,
      trades: tradie.trades,
      upcomingBookings: tradie.schedules.map((s) => ({
        projectName: s.project.name,
        scheduledDate: s.scheduledDate,
        status: s.status,
      })),
    }),
  );
}

/** What the digest reads beyond the records: injected to keep imports one-way. */
export type OfficeDigestExtras = {
  /** The documents the index could not read (./files.ts). */
  readonly unreadDocuments?: (
    db: DomainDb,
    now: Date,
  ) => Promise<NonNullable<OfficeDigestSource["unreadDocuments"]>>;
};

export async function loadOfficeDigest(
  db: DomainDb,
  now: Date,
  extras: OfficeDigestExtras = {},
): Promise<ChunkDraft> {
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  // From the start of today in Sydney, not from now: a meeting is stored on
  // its day with the time beside it, and the digest is built early in the
  // morning, so "now" would drop every meeting booked for today.
  const startOfToday = sydneyStartOfDay(sydneyToday(now));
  const [
    leadStages,
    offerStatuses,
    projectStatuses,
    overdueTasks,
    upcomingMeetings,
    awaitingSignature,
    activeProjects,
    openComplianceAlerts,
    outstanding,
    overdueTaskCount,
    unreadDocuments,
  ] = await Promise.all([
    db.lead.groupBy({
      by: ["stage"],
      _count: { _all: true },
      where: { isArchived: false },
    }),
    db.offer.groupBy({
      by: ["offerStatus"],
      _count: { _all: true },
      where: { isActive: true, lead: { isArchived: false } },
    }),
    db.project.groupBy({ by: ["status"], _count: { _all: true } }),
    db.leadTask.findMany({
      orderBy: { dueDate: "asc" },
      select: { dueDate: true, lead: { select: { name: true } }, type: true },
      take: 15,
      // LIVE_LEAD, as the Follow-ups tab and the reminder crons read it: an
      // overdue task on a lost or won deal is not work. The digest used to
      // check only isArchived, and led the weekly overview with a wait on a
      // Lost lead from February (#429).
      where: overdueLeadTaskWhere(now),
    }),
    // A meeting is a MEETING lead task since #193. This read the retired
    // `Lead.meetingDate` column, which the task form never sets, so the
    // snapshot said "none booked" beside a full diary (#618).
    db.leadTask.findMany({
      orderBy: [{ dueDate: "asc" }, { dueTime: "asc" }],
      select: {
        dueDate: true,
        dueTime: true,
        lead: { select: { name: true } },
      },
      take: 15,
      where: meetingsBetweenWhere({
        assignedId: null,
        from: startOfToday,
        to: weekAhead,
      }),
    }),
    db.offer.findMany({
      orderBy: { sentAt: "asc" },
      select: {
        baseReference: true,
        lead: { select: { name: true } },
        leadId: true,
        offerStatus: true,
        revisionNumber: true,
        sentAt: true,
      },
      take: 15,
      where: {
        isActive: true,
        lead: { isArchived: false },
        offerStatus: { in: [...OFFER_AWAITING_SIGNATURE_STATUSES] },
      },
    }),
    db.project.findMany({
      orderBy: { name: "asc" },
      select: {
        milestones: {
          orderBy: { order: "asc" },
          select: { name: true, status: true },
          where: { status: { in: ["ACTIVE", "PENDING"] } },
        },
        name: true,
        status: true,
      },
      take: 25,
      where: projectInProgressWhere(),
    }),
    db.complianceAlert.count({ where: { status: "OPEN" } }),
    db.invoice.aggregate({
      _count: { _all: true },
      _sum: { amountDue: true },
      where: {
        amountDue: { gt: 0 },
        status: { notIn: ["DRAFT", "VOIDED", "DELETED"] },
      },
    }),
    db.leadTask.count({ where: overdueLeadTaskWhere(now) }),
    extras.unreadDocuments?.(db, now) ?? Promise.resolve([]),
  ]);

  return officeDigestChunk({
    activeProjects: activeProjects.map((project) => ({
      currentActivity:
        project.milestones.find((m) => m.status === "ACTIVE")?.name ?? null,
      name: project.name,
      nextActivity:
        project.milestones.find((m) => m.status === "PENDING")?.name ?? null,
      status: project.status,
    })),
    awaitingSignature: awaitingSignature.map((offer) => ({
      leadName: offer.lead.name,
      reference: `${offer.baseReference.trim() || `OF-${offer.leadId}`}-R${offer.revisionNumber}`,
      sentAt: offer.sentAt,
      status: offer.offerStatus,
    })),
    generatedAt: now,
    leadsByStage: Object.fromEntries(
      leadStages.map((row) => [row.stage, row._count._all]),
    ),
    offersByStatus: Object.fromEntries(
      offerStatuses.map((row) => [row.offerStatus, row._count._all]),
    ),
    openComplianceAlerts,
    overdueTaskCount,
    unreadDocuments,
    outstandingInvoices: {
      amountDue: Number(outstanding._sum.amountDue ?? 0),
      count: outstanding._count._all,
    },
    overdueTasks: overdueTasks.flatMap((task) =>
      task.dueDate
        ? [{ dueDate: task.dueDate, leadName: task.lead.name, type: task.type }]
        : [],
    ),
    projectsByStatus: Object.fromEntries(
      projectStatuses.map((row) => [row.status, row._count._all]),
    ),
    upcomingMeetings: upcomingMeetings.flatMap((meeting) =>
      meeting.dueDate
        ? [
            {
              date: meeting.dueDate,
              leadName: meeting.lead.name,
              time: meeting.dueTime,
            },
          ]
        : [],
    ),
  });
}

/** Every chunk a selection covers; a full refresh also rebuilds the digest. */
export async function loadContextChunks(
  db: DomainDb,
  now: Date,
  selection?: ContextSelection,
  extras: OfficeDigestExtras = {},
): Promise<ChunkDraft[]> {
  if (!selection) {
    const [leads, offers, projects, tradies, digest] = await Promise.all([
      loadLeadChunks(db, now),
      loadOfferChunks(db, now),
      loadProjectChunks(db, now),
      loadTradieChunks(db, now),
      loadOfficeDigest(db, now, extras),
    ]);
    return [...leads, ...offers, ...projects, ...tradies, digest];
  }
  const [leads, offers, projects, tradies] = await Promise.all([
    selection.leadIds?.length ? loadLeadChunks(db, now, selection.leadIds) : [],
    selection.leadIds?.length
      ? loadOfferChunks(db, now, selection.leadIds)
      : [],
    selection.projectIds?.length
      ? loadProjectChunks(db, now, selection.projectIds)
      : [],
    selection.tradieIds?.length
      ? loadTradieChunks(db, now, selection.tradieIds)
      : [],
  ]);
  return [...leads, ...offers, ...projects, ...tradies];
}
