import { Prisma, ProjectStatus } from "@prisma/client";

import { certifierEngagementInclude } from "@/types/compliance";
import {
  DRAFTING_FILTER,
  OPEN_PROJECTS_FILTER,
  type ProjectDetail,
  type ProjectKPIs,
  type ProjectWithStats,
} from "@/types/project";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import { summarizeInvoices } from "@/lib/projects/invoice-totals";

import {
  canOpenHbcfDocuments,
  canSeeProjectFinancials,
  projectManageScope,
  projectReadScope,
} from "../access/projects";
import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import { serializeInvoice, serializeListInvoice } from "../invoices/serialize";
import type { DomainPrincipal } from "../principal";
import { bookingBilling } from "../tradies/billing-rules";
import {
  draftingProjectWhere,
  needingAttention,
  readProjectAttention,
} from "./attention";
import { readProjectDetailRow } from "./detail-read";
import {
  hideDetailProjectFinancials,
  hideListProjectFinancials,
} from "./financial-redaction";
import { canSeeMilestoneNotes } from "./milestone-note-rules";
import { readProjectDocuments } from "./documents";

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
   * One status, or one of the derived filters:
   *
   *   - `OPEN_PROJECTS_FILTER` — everything but COMPLETED, the list's "All"
   *   - `DRAFTING_FILTER`      — not finished and no activity started
   *   - `NEEDS_ATTENTION`      — has at least one live attention condition.
   *     The enum value is no longer written to a project (issue #452), so as a
   *     filter it means the derived set, not the stored column; old links to
   *     `?status=NEEDS_ATTENTION` keep working and now show the right jobs.
   *
   * Absent means every project, completed included.
   */
  status?:
    | ProjectStatus
    | typeof OPEN_PROJECTS_FILTER
    | typeof DRAFTING_FILTER
    | null;
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

/**
 * Who wrote a log line or a site update: the name is all the page shows. The
 * whole `User` row would put staff phone numbers, emails and Clerk ids into a
 * payload a CUSTOMER can be served (issue #411).
 */
const authorSummary = { select: { id: true, name: true } } as const;

/** What the header, the picker and Eve read off the site manager. */
const siteManagerSummary = {
  select: { id: true, name: true, email: true, phone: true },
} as const;

/** What a booking row reads off its activity (`BookingMilestone`). */
const bookingMilestone = {
  select: {
    id: true,
    name: true,
    status: true,
    targetDate: true,
    startDate: true,
    budget: true,
    spend: true,
    parentId: true,
    order: true,
    projectStage: true,
  },
} as const;

export const projectDetailInclude = {
  customer: true,
  siteManager: siteManagerSummary,
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
      author: authorSummary,
    },
  },
  // No `tradieSchedules` under each milestone: they are the project-level
  // `tradieSchedules` again, filtered by `milestoneId`, and the two copies
  // drifted (a new booking reached one and not the other). A milestone's
  // bookings are `project.tradieSchedules` with its `milestoneId`.
  milestones: {
    orderBy: { order: "asc" as const },
    include: {
      requiredTradeTypes: {
        select: { id: true, label: true },
        orderBy: { label: "asc" as const },
      },
      siteUpdates: {
        include: {
          author: authorSummary,
        },
      },
      // Staff notes, newest first. Empty for a customer: see
      // `canSeeMilestoneNotes` and `readProjectDetailRow`.
      notes: {
        orderBy: [
          { createdAt: "desc" },
          { id: "asc" },
        ] as Prisma.MilestoneNoteOrderByWithRelationInput[],
        include: { author: authorSummary },
      },
      // Not a duplicate of the project's `files`: a milestone photo can carry
      // only its `milestoneId`.
      files: true,
    },
  },
  siteUpdates: {
    orderBy: { createdAt: "desc" as const },
    include: {
      author: authorSummary,
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
      milestone: bookingMilestone,
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
          request: {
            select: { id: true, createdAt: true, subject: true, kind: true },
          },
        },
      },
      // Status and amount only: enough for the booking's billing state on the
      // Tradies tab, without putting the invoices themselves on the page.
      invoices: { select: { status: true, subTotal: true } },
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

/**
 * What `getProjectDetail` reads, as Prisma would type it. The include above is
 * the contract; `detail-read.ts` is the SQL that returns it.
 */
type ProjectDetailRow = Prisma.ProjectGetPayload<{
  include: typeof projectDetailInclude;
}>;

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
  attentionIds: readonly string[] | null,
): Prisma.ProjectWhereInput {
  const search = normalizeSearch(query?.search);
  const filters: Prisma.ProjectWhereInput[] = [];

  if (query?.status === OPEN_PROJECTS_FILTER) {
    filters.push({ status: { not: ProjectStatus.COMPLETED } });
  } else if (query?.status === DRAFTING_FILTER) {
    filters.push(draftingProjectWhere);
  } else if (query?.status === ProjectStatus.NEEDS_ATTENTION) {
    filters.push({ id: { in: [...(attentionIds ?? [])] } });
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
function withProjectStats(
  { variations, invoices, ...project }: ListRow,
  attention: ProjectWithStats["attention"] = null,
): ProjectWithStats {
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
    attention,
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
  // Needs Attention is derived from live records, so the filter first finds
  // which projects have a condition, and the listing then pages, searches,
  // sorts and counts within them like any other filter.
  const attentionIds =
    query?.status === ProjectStatus.NEEDS_ATTENTION
      ? needingAttention(await readProjectAttention(principal, db)).map(
          (project) => project.projectId,
        )
      : null;
  const where = buildProjectWhere(
    principal,
    query,
    options.scope ?? "read",
    attentionIds,
  );
  // Sorting by budget or spend would hand the ordering of the money to a caller
  // who may not see it, one comparison at a time.
  const showFinancials = canSeeProjectFinancials(principal);
  const sortBy =
    !showFinancials && (query?.sortBy === "budget" || query?.sortBy === "spent")
      ? undefined
      : query?.sortBy;
  const orderBy = buildProjectOrderBy(sortBy, query?.sortOrder);

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

  // The page's own conditions, so each row can say why it needs attention.
  const attention = new Map(
    (
      await readProjectAttention(principal, db, {
        projectIds: projects.map((project) => project.id),
      })
    ).map((entry) => [entry.projectId, entry]),
  );

  return {
    items: projects.map((project) => {
      const item = withProjectStats(project, attention.get(project.id) ?? null);
      return showFinancials
        ? item
        : hideListProjectFinancials(item, {
            hbcfLinks: canOpenHbcfDocuments(principal),
          });
    }),
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
  const showFinancials = canSeeProjectFinancials(principal);
  return projects.map((project) => {
    const item = withProjectStats(project);
    return showFinancials
      ? item
      : hideListProjectFinancials(item, {
          hbcfLinks: canOpenHbcfDocuments(principal),
        });
  });
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
  // Three reads side by side, each needing only the project's id: the project
  // and its lists in one SQL statement (`detail-read.ts`), its certifier
  // engagement in the compliance module's own shape, and its documents. The
  // last two are dropped unless the scoped read finds the project.
  const [found, certifierEngagement, documents] = await Promise.all([
    readProjectDetailRow(projectId, projectReadScope(principal), db, {
      milestoneNotes: canSeeMilestoneNotes(principal),
    }),
    db.certifierEngagement.findUnique({
      where: { projectId },
      include: certifierEngagementInclude,
    }),
    readProjectDocuments({ id: projectId }, db),
  ]);

  if (!found) return null;
  const project = {
    ...found,
    certifierEngagement,
  } as unknown as ProjectDetailRow;
  // `Lead` is the raw relation, shaped into `lead` here and not sent twice.
  const { Lead: rawLead, ...row } = project;

  const detail: ProjectDetail = {
    ...row,
    documents,
    lead: {
      id: rawLead.id,
      email: rawLead.email,
      type: rawLead.type.join(", "),
      location: rawLead.location,
      emails: rawLead.emails,
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
    })),
    // Every Decimal as a string: the detail crosses into client components,
    // which cannot receive a Decimal.
    variations: project.variations.map((variation) => ({
      ...variation,
      cost: variation.cost.toString(),
      invoiceAmountPaid: variation.invoiceAmountPaid?.toString() ?? null,
      invoiceTax: variation.invoiceTax?.toString() ?? null,
      invoiceTotal: variation.invoiceTotal?.toString() ?? null,
      newPrice: variation.newPrice?.toString() ?? null,
      previousPrice: variation.previousPrice?.toString() ?? null,
    })),
    tradieSchedules: project.tradieSchedules.map(
      ({ invoices, ...schedule }) => ({
        ...schedule,
        // The same rule the Financials tab and the record command use.
        billing: bookingBilling({ ...schedule, invoices }),
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
      }),
    ),
  };
  return canSeeProjectFinancials(principal)
    ? detail
    : hideDetailProjectFinancials(detail, {
        hbcfLinks: canOpenHbcfDocuments(principal),
      });
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
  drafting: 0,
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
  const [rows, drafting, attention] = await Promise.all([
    db.project.groupBy({
      by: ["status"],
      where: projectReadScope(principal),
      _count: { _all: true },
    }),
    db.project.count({
      where: { ...projectReadScope(principal), ...draftingProjectWhere },
    }),
    readProjectAttention(principal, db),
  ]);

  const countOf = (...statuses: ProjectStatus[]) =>
    rows
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

  const total = rows.reduce((sum, row) => sum + row._count._all, 0);

  return {
    totalActive: total - countOf(ProjectStatus.COMPLETED),
    active: countOf(ProjectStatus.ACTIVE),
    onTrack: countOf(ProjectStatus.ON_TRACK),
    // Derived, like the filter it counts for: the stored status is no longer
    // written (issue #452).
    needsAttention: needingAttention(attention).length,
    delayed: countOf(ProjectStatus.DELAYED),
    completed: countOf(ProjectStatus.COMPLETED),
    drafting,
  };
}

/** All zeroes, for an adapter that must render a dashboard after a failure. */
export { EMPTY_KPIS as emptyProjectKPIs };
