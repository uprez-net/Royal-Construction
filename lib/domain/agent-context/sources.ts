import type { Prisma } from "@prisma/client";
import type { DomainDb } from "../db";
import {
  leadChunk,
  officeDigestChunk,
  projectChunk,
  tradieChunk,
  type ChunkDraft,
} from "./text";

// Reads the CRM and lays it out with ./text. Kept apart from the builders so
// the wording can be tested without a database and the queries without caring
// about the wording.

/** Closed deals stay in the index this long after they last changed. */
export const RECENTLY_CLOSED_DAYS = 60;
const CLOSED_LEAD_STAGES = [
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

export async function loadLeadChunks(
  db: DomainDb,
  now: Date,
  leadIds?: readonly number[],
): Promise<ChunkDraft[]> {
  const leads = await db.lead.findMany({
    where: leadIds
      ? { id: { in: [...leadIds] }, isArchived: false }
      : {
          isArchived: false,
          OR: [
            { stage: { notIn: [...CLOSED_LEAD_STAGES] } },
            { updatedAt: { gte: recentCutoff(now) } },
          ],
        },
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

  return leads.map((lead) => {
    const offer = lead.offers[0];
    return leadChunk({
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
    where: projectIds
      ? { id: { in: [...projectIds] } }
      : {
          OR: [
            { status: { not: "COMPLETED" } },
            { updatedAt: { gte: recentCutoff(now) } },
          ],
        },
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
        where: { status: { notIn: ["VOIDED", "DELETED"] } },
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

  return projects.map((project) => {
    const customerNames = project.customers.length
      ? project.customers.map((entry) => entry.customer.name)
      : [project.customer.name];
    return projectChunk({
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

const SIGNATURE_STATUSES = [
  "SENT",
  "OFFER_SENT",
  "TENDER_SENT",
  "CONTRACT_SENT",
] as const;

export async function loadOfficeDigest(
  db: DomainDb,
  now: Date,
): Promise<ChunkDraft> {
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
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
      where: {
        dueDate: { lt: now },
        lead: { isArchived: false },
        status: { not: "DONE" },
      },
    }),
    db.lead.findMany({
      orderBy: { meetingDate: "asc" },
      select: { meetingDate: true, meetingTime: true, name: true },
      take: 15,
      where: {
        isArchived: false,
        meetingCompletedAt: null,
        meetingDate: { gte: now, lte: weekAhead },
      },
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
        offerStatus: { in: [...SIGNATURE_STATUSES] },
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
      where: { status: { notIn: ["COMPLETED", "DRAFT"] } },
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
    upcomingMeetings: upcomingMeetings.flatMap((lead) =>
      lead.meetingDate
        ? [
            {
              date: lead.meetingDate,
              leadName: lead.name,
              time: lead.meetingTime,
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
): Promise<ChunkDraft[]> {
  if (!selection) {
    const [leads, projects, tradies, digest] = await Promise.all([
      loadLeadChunks(db, now),
      loadProjectChunks(db, now),
      loadTradieChunks(db, now),
      loadOfficeDigest(db, now),
    ]);
    return [...leads, ...projects, ...tradies, digest];
  }
  const [leads, projects, tradies] = await Promise.all([
    selection.leadIds?.length ? loadLeadChunks(db, now, selection.leadIds) : [],
    selection.projectIds?.length
      ? loadProjectChunks(db, now, selection.projectIds)
      : [],
    selection.tradieIds?.length
      ? loadTradieChunks(db, now, selection.tradieIds)
      : [],
  ]);
  return [...leads, ...projects, ...tradies];
}
