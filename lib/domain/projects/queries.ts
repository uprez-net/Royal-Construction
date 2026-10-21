import { Prisma, ProjectStatus } from "@prisma/client";

import { certifierEngagementInclude } from "@/types/compliance";
import {
  PRE_CONSTRUCTION_FILTER,
  PRE_CONSTRUCTION_STATUSES,
  type ProjectDetail,
  type ProjectKPIs,
  type ProjectWithStats,
} from "@/types/project";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import { summarizeInvoices } from "@/lib/projects/invoice-totals";

import { projectManageScope, projectReadScope } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import { serializeInvoice, serializeListInvoice } from "../invoices/serialize";
import type { DomainPrincipal } from "../principal";

// Every read of a project, its list, its KPIs and its lookup — one place, one
// scope (issue #301, phase 4).
//
// Before this module there were three separate readers with three different
// ideas of who may see what:
//
//   - `lib/data/projects.ts` applied NO scope. Any signed-in caller saw every
//     project, and the route handler above it added no guard either.
//   - `agent/lib/project-operations.ts#searchAuthorizedProjects` spelled the
//     scope inline as `actor.role === "ADMIN" ? {} : { siteManagerId }`, a
//     fourth copy of the manage rule.
//   - `app/api/(data)/projects/[projectId]/route.ts` had its own inline
//     `canEditProject`, wider again (it also let the lead's assignee and the
//     owning customer through).
//
// The scope lives in `lib/domain/access/projects.ts` now and this module is
// the only thing that reads the `Project` table for a listing or a detail.
// Everything a screen needs is shaped here, so the App page and the Eve tool
// see the same numbers.

export type ProjectListSortBy =
  | "name"
  | "progress"
  | "budget"
  | "startDate"
  | "spent";

export type ProjectListQuery = {
  /**
   * One status, or `PRE_CONSTRUCTION_FILTER` for the three that precede a
   * build. Widened from `ProjectStatus` for that one value rather than for
   * arbitrary strings, so a typo is still a compile error at every call site.
   */
  status?: ProjectStatus | typeof PRE_CONSTRUCTION_FILTER | null;
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: ProjectListSortBy;
  sortOrder?: "asc" | "desc";
};

export type PaginatedProjectsResult = {
  items: ProjectWithStats[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

export type ProjectLookupItem = {
  id: string;
  name: string;
  location: string;
};

export type PaginatedProjectLookupResult = {
  items: ProjectLookupItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const projectInclude = {
  customer: true,
  siteManager: true,
  variations: true,
  // A summary row per claim — enough for the quick-view's claims table and the
  // cleared-money roll-up, without the PDF link and tax breakdown the detail
  // payload carries. Bounded at one per contract stage by the unique index.
  invoices: {
    select: {
      id: true,
      invoiceNumber: true,
      projectStage: true,
      status: true,
      total: true,
      amountPaid: true,
      amountDue: true,
      issuedDate: true,
      dueDate: true,
    },
    orderBy: { issuedDate: "desc" },
  },
  milestones: {
    select: {
      id: true,
      name: true,
      status: true,
      projectStage: true,
      targetDate: true,
      actualDate: true,
      tradies: {
        select: {
          name: true,
          trade: true,
        },
      },
    },
  },
} as const;

const projectDetailInclude = {
  customer: true,
  siteManager: true,
  // Newest first: the Payments tab reads as a claim history, most recent at the
  // top, and the stage order is already carried on each row.
  invoices: { orderBy: { issuedDate: "desc" } },
  Lead: {
    select: {
      id: true,
      email: true,
      type: true,
      location: true,
      emails: {
        orderBy: { sentAt: "asc" as const },
      },
    },
  },
  activityLogs: {
    orderBy: { createdAt: "desc" as const },
    include: {
      author: true,
    },
  },
  milestones: {
    orderBy: { order: "asc" as const },
    include: {
      requiredTradeTypes: {
        select: { id: true, label: true },
        orderBy: { label: "asc" as const },
      },
      siteUpdates: {
        include: {
          author: true,
        },
      },
      tradieSchedules: {
        include: {
          tradie: true,
        },
      },
      files: true,
    },
  },
  siteUpdates: {
    orderBy: { createdAt: "desc" as const },
    include: {
      author: true,
      milestone: true,
    },
  },
  variations: {
    orderBy: { createdAt: "desc" as const },
  },
  tradieSchedules: {
    orderBy: { scheduledDate: "asc" as const },
    include: {
      tradie: true,
      milestone: true,
      // The delivery, not the stored email: the html is only for resending.
      requestRecipient: {
        select: {
          id: true,
          deliveryStatus: true,
          attempts: true,
          lastAttemptAt: true,
          nextAttemptAt: true,
          sentAt: true,
          lastError: true,
          toAddress: true,
          createdAt: true,
          request: { select: { id: true, createdAt: true, subject: true } },
        },
      },
      quote: {
        select: {
          id: true,
          source: true,
          gstTreatment: true,
          quotedAt: true,
          validUntil: true,
          notes: true,
          enteredBy: { select: { name: true } },
        },
      },
    },
  },
  tradeSelections: {
    orderBy: { selectedAt: "desc" as const },
    select: {
      id: true,
      trade: true,
      tradeKey: true,
      tradieId: true,
      status: true,
      selectedAt: true,
      cancelledAt: true,
      tradie: { select: { name: true } },
      selectedBy: { select: { name: true } },
    },
  },
  files: true,
  materials: true,
  // Carried on the detail payload rather than fetched by the tab, so the tab
  // badge, the tab body and the compliance alert all read one consistent
  // snapshot instead of three that can disagree mid-render.
  // The canonical shape, not a copy of it.
  certifierEngagement: { include: certifierEngagementInclude },
} as const;

const defaultPageSize = 12;
const defaultLookupPageSize = 10;

function normalizeSearch(search?: string) {
  return search?.trim() ?? "";
}

function safePage(page: number | undefined): number {
  const value = page ?? 1;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function safeLimit(limit: number | undefined, fallback: number, cap: number) {
  const value = limit ?? fallback;
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), cap)
    : fallback;
}

/**
 * Which projects a listing may return.
 *
 * `"read"` is the screens' answer — staff see every project, a customer sees
 * their own. `"manage"` is narrower and is what Eve's project search asks for:
 * every operation the agent offers next is manage-scoped, so a search that
 * listed projects the caller cannot then act on would only produce refusals.
 */
export type ProjectListScope = "read" | "manage";

function scopeFilter(
  principal: DomainPrincipal,
  scope: ProjectListScope,
): Prisma.ProjectWhereInput {
  return scope === "manage"
    ? projectManageScope(principal)
    : projectReadScope(principal);
}

/**
 * The Prisma `where` for a project listing: the caller's scope, then the
 * requested filters.
 *
 * The scope is spread first and the filters are `AND`-ed under it, so no
 * search term can widen what a customer sees.
 */
function buildProjectWhere(
  principal: DomainPrincipal,
  query: ProjectListQuery | undefined,
  scope: ProjectListScope,
): Prisma.ProjectWhereInput {
  const search = normalizeSearch(query?.search);
  const filters: Prisma.ProjectWhereInput[] = [];

  if (query?.status === PRE_CONSTRUCTION_FILTER) {
    filters.push({ status: { in: [...PRE_CONSTRUCTION_STATUSES] } });
  } else if (query?.status) {
    filters.push({ status: query.status });
  }

  if (search) {
    filters.push({
      OR: [
        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
        {
          customer: {
            name: { contains: search, mode: Prisma.QueryMode.insensitive },
          },
        },
        {
          siteManager: {
            name: { contains: search, mode: Prisma.QueryMode.insensitive },
          },
        },
      ],
    });
  }

  return {
    ...scopeFilter(principal, scope),
    ...(filters.length > 0 ? { AND: filters } : {}),
  };
}

function buildProjectOrderBy(
  sortBy?: ProjectListSortBy,
  sortOrder: "asc" | "desc" = "asc",
): Prisma.ProjectOrderByWithRelationInput[] {
  const direction = sortOrder === "asc" ? "asc" : "desc";

  switch (sortBy) {
    case "budget":
      return [{ totalBudget: direction }, { createdAt: "desc" }];
    case "spent":
      return [{ spent: direction }, { createdAt: "desc" }];
    case "startDate":
      return [{ startDate: direction }, { createdAt: "desc" }];
    case "progress":
      return [{ updatedAt: direction }, { createdAt: "desc" }];
    case "name":
    default:
      return [{ name: direction }, { createdAt: "desc" }];
  }
}

type ListRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** Progress, milestone counts and approved variation spend for a list row. */
function withProjectStats({
  variations,
  invoices,
  ...project
}: ListRow): ProjectWithStats {
  const milestoneCount = project.milestones.length;
  const completedMilestoneCount = project.milestones.filter((milestone) =>
    ["DONE", "NOT_REQUIRED"].includes(milestone.status),
  ).length;
  const progressPercent =
    milestoneCount === 0
      ? 0
      : Math.round((completedMilestoneCount / milestoneCount) * 100);
  const approvedVariationSpend = variations
    .filter((variation) => variation.status === "APPROVED")
    .reduce((sum, variation) => sum + Number(variation.cost), 0);

  return {
    ...project,
    requirements: project.requirements as unknown as ProjectRequirementsPayload,
    milestones: project.milestones.map((milestone) => ({
      ...milestone,
      tradies: milestone.tradies.map((tradie) => ({
        name: tradie.name,
        tradeType: tradie.trade,
      })),
    })),
    lotSize: project.lotSize?.toString() ?? undefined,
    totalBudget: project.totalBudget.toString(),
    spent: project.spent.toString(),
    milestoneCount,
    completedMilestoneCount,
    progressPercent,
    approvedVariationSpend: approvedVariationSpend.toString(),
    invoiceTotals: summarizeInvoices(invoices),
    invoices: invoices.map(serializeListInvoice),
  };
}

/**
 * A page of projects the caller may see, with the computed statistics the
 * project cards render.
 *
 * Throws rather than returning an empty page. `lib/data/projects.ts#getProjects`
 * swallowed every error into `{ items: [] }`, which renders identically to "you
 * have no projects" — a database outage and an empty database were the same
 * screen. The adapter decides what to show; the rule does not lie about it.
 */
export async function listProjects(
  principal: DomainPrincipal,
  query: ProjectListQuery | undefined,
  db: DomainDb,
  options: { scope?: ProjectListScope } = {},
): Promise<PaginatedProjectsResult> {
  const page = safePage(query?.page);
  const limit = safeLimit(query?.limit, defaultPageSize, 100);
  const where = buildProjectWhere(principal, query, options.scope ?? "read");
  const orderBy = buildProjectOrderBy(query?.sortBy, query?.sortOrder);

  const [projects, totalCount] = await Promise.all([
    db.project.findMany({
      where,
      include: projectInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.project.count({ where }),
  ]);

  return {
    items: projects.map(withProjectStats),
    page,
    limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  };
}

/** Every project the caller may see, for the projects page's CSV export. */
export async function listAllProjectsForExport(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<ProjectWithStats[]> {
  const projects = await db.project.findMany({
    where: projectReadScope(principal),
    include: projectInclude,
  });
  return projects.map(withProjectStats);
}

/** Id, name and location only — for autocompletes and lookup dialogs. */
export async function listProjectsForLookup(
  principal: DomainPrincipal,
  input: { page?: number; limit?: number; query?: string },
  db: DomainDb,
): Promise<PaginatedProjectLookupResult> {
  const page = safePage(input.page);
  const limit = safeLimit(input.limit, defaultLookupPageSize, 50);
  const search = normalizeSearch(input.query);

  const where: Prisma.ProjectWhereInput = {
    ...projectReadScope(principal),
    ...(search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            {
              location: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : {}),
  };

  const [items, totalCount] = await Promise.all([
    db.project.findMany({
      where,
      select: { id: true, name: true, location: true },
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.project.count({ where }),
  ]);

  return {
    items,
    page,
    limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  };
}

/**
 * The full project payload the detail screen renders, or `null` when the
 * project does not exist — or exists outside the caller's read scope, which is
 * the same answer on purpose: a customer learning that another customer's
 * project id is real is a disclosure.
 */
export async function getProjectDetail(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<ProjectDetail | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, ...projectReadScope(principal) },
    include: projectDetailInclude,
  });

  if (!project) return null;

  return {
    ...project,
    lead: {
      id: project.Lead.id,
      email: project.Lead.email,
      type: project.Lead.type.join(", "),
      location: project.Lead.location,
      emails: project.Lead.emails,
    },
    requirements: project.requirements as unknown as ProjectRequirementsPayload,
    materials: project.materials.map((material) => ({
      ...material,
      unitCost: material.unitCost.toString(),
      totalCost: material.totalCost.toString(),
    })),
    lotSize: project.lotSize?.toString() ?? undefined,
    totalBudget: project.totalBudget.toString(),
    spent: project.spent.toString(),
    invoices: project.invoices.map(serializeInvoice),
    siteUpdates: project.siteUpdates
      .filter((siteUpdate) => siteUpdate.milestone !== null)
      .map((siteUpdate) => ({
        ...siteUpdate,
        milestone: {
          ...siteUpdate.milestone!,
          spend: siteUpdate.milestone!.spend?.toString(),
          budget: siteUpdate.milestone!.budget.toString(),
        },
      })),
    milestones: project.milestones.map((milestone) => ({
      ...milestone,
      spend: milestone.spend?.toString(),
      budget: milestone.budget.toString(),
      tradieSchedules: milestone.tradieSchedules.map((schedule) => ({
        ...schedule,
        tradie: {
          ...schedule.tradie,
          lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString(),
          rating: schedule.tradie.rating?.toString(),
        },
      })),
    })),
    variations: project.variations.map((variation) => ({
      ...variation,
      cost: variation.cost.toString(),
    })),
    tradieSchedules: project.tradieSchedules.map((schedule) => ({
      ...schedule,
      tradie: {
        ...schedule.tradie,
        lastQuotedPrice: schedule.tradie.lastQuotedPrice?.toString(),
        rating: schedule.tradie.rating?.toString(),
      },
      milestone: schedule.milestone
        ? {
            ...schedule.milestone,
            budget: schedule.milestone.budget.toString(),
            spend: schedule.milestone.spend?.toString(),
          }
        : undefined,
    })),
  };
}

/** `getProjectDetail`, refusing instead of answering null. */
export async function requireProjectDetail(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<ProjectDetail> {
  const detail = await getProjectDetail(principal, projectId, db);
  if (!detail) throw new DomainNotFoundError("Project not found");
  return detail;
}

const EMPTY_KPIS: ProjectKPIs = {
  totalActive: 0,
  active: 0,
  onTrack: 0,
  needsAttention: 0,
  delayed: 0,
  completed: 0,
  preConstruction: 0,
};

/**
 * The dashboard counters, over the projects the caller may see.
 *
 * Grouped in SQL rather than counted seven times. The scope is applied through
 * Prisma's own `groupBy` instead of the raw query this used to be: a raw
 * `SELECT … FROM "Project"` cannot carry a `where` fragment without string
 * interpolation, and a KPI tile that counts rows the caller is not allowed to
 * list is the leak the tile is least likely to be checked for.
 */
export async function getProjectKPIs(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<ProjectKPIs> {
  const rows = await db.project.groupBy({
    by: ["status"],
    where: projectReadScope(principal),
    _count: { _all: true },
  });

  const countOf = (...statuses: ProjectStatus[]) =>
    rows
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

  const total = rows.reduce((sum, row) => sum + row._count._all, 0);

  return {
    totalActive: total - countOf(ProjectStatus.COMPLETED),
    active: countOf(ProjectStatus.ACTIVE),
    onTrack: countOf(ProjectStatus.ON_TRACK),
    needsAttention: countOf(ProjectStatus.NEEDS_ATTENTION),
    delayed: countOf(ProjectStatus.DELAYED),
    completed: countOf(ProjectStatus.COMPLETED),
    // The pipeline: created, in compliance, or through compliance and waiting
    // to start. Counted together because that is the question the chip asks —
    // how many jobs have not begun.
    preConstruction: countOf(
      ProjectStatus.DRAFT,
      ProjectStatus.COMPLIANCE_STARTED,
      ProjectStatus.COMPLIANCE_COMPLETED,
    ),
  };
}

/** All zeroes, for an adapter that must render a dashboard after a failure. */
export { EMPTY_KPIS as emptyProjectKPIs };
