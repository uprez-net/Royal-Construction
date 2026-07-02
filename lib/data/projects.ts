"use server";

import { Prisma, ProjectStatus } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import prisma from "@/lib/prisma";
import { ProjectDetail, ProjectKPIs, ProjectWithStats } from "@/types/project";
import { CACHE_PROFILES } from "@/types/cache";

export type ProjectListSortBy = "name" | "progress" | "budget" | "startDate" | "spent";

export type ProjectListQuery = {
  status?: ProjectStatus | null;
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
  milestones: {
    select: {
      id: true,
      name: true,
      status: true,
      targetDate: true,
      actualDate: true,
      tradies: {
        select: {
          name: true,
          trade: true,
        },
      }
    },
  },
} as const;

const projectDetailInclude = {
  customer: true,
  siteManager: true,
  activityLogs: {
    orderBy: { createdAt: "desc" as const },
    include: {
      author: true,
    },
  },
  milestones: {
    orderBy: { order: "asc" as const },
    include: {
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
    },
  },
  files: true,
  materials: true,
} as const;

const defaultPageSize = 12;
const defaultLookupPageSize = 10;

/**
 * Normalizes a search string by trimming leading and trailing whitespace.
 *
 * @param search - Raw search query.
 * @returns The trimmed search string, or an empty string if undefined.
 */
function normalizeSearch(search?: string) {
  return search?.trim() ?? "";
}

/**
 * Builds the Prisma `where` clause used when querying projects.
 *
 * Supports filtering by:
 * - Project status
 * - Project name
 * - Project location
 * - Customer name
 * - Site manager name
 *
 * Searches are performed using case-insensitive partial matching.
 *
 * @param query - Optional project list query parameters.
 * @returns A Prisma `ProjectWhereInput` object, or `undefined` when no filters are applied.
 */
function buildProjectWhere(query?: ProjectListQuery): Prisma.ProjectWhereInput | undefined {
  const search = normalizeSearch(query?.search);

  const filters: Prisma.ProjectWhereInput[] = [];

  if (query?.status) {
    filters.push({ status: query.status });
  }

  if (search) {
    filters.push({
      OR: [
        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
        { customer: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
        { siteManager: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
      ],
    });
  }

  if (filters.length === 0) {
    return undefined;
  }

  return { AND: filters };
}

/**
 * Builds the Prisma `orderBy` clause for project listings.
 *
 * Supports sorting by:
 * - Name
 * - Budget
 * - Amount spent
 * - Start date
 * - Progress
 *
 * A secondary sort by creation date is always applied to ensure deterministic
 * ordering when primary sort values are identical.
 *
 * @param sortBy - Field to sort by.
 * @param sortOrder - Sort direction.
 * @returns Prisma orderBy configuration.
 */
function buildProjectOrderBy(sortBy?: ProjectListSortBy, sortOrder: "asc" | "desc" = "asc"): Prisma.ProjectOrderByWithRelationInput[] {
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

/**
 * Retrieves a paginated list of projects from the database.
 *
 * This internal helper:
 * - Applies search, filtering, sorting and pagination.
 * - Calculates milestone statistics.
 * - Calculates project progress percentage.
 * - Computes approved variation costs.
 * - Converts Prisma Decimal values into strings for serialization.
 *
 * @param query - Pagination, filtering and sorting options.
 * @returns A paginated collection of projects with computed statistics.
 */
async function getProjectsPage(query?: ProjectListQuery): Promise<PaginatedProjectsResult> {
  const safePage = Number.isFinite(query?.page ?? 1) && (query?.page ?? 1) > 0 ? Math.floor(query?.page ?? 1) : 1;
  const safeLimit = Number.isFinite(query?.limit ?? defaultPageSize) && (query?.limit ?? defaultPageSize) > 0
    ? Math.min(Math.floor(query?.limit ?? defaultPageSize), 100)
    : defaultPageSize;
  const where = buildProjectWhere(query);
  const orderBy = buildProjectOrderBy(query?.sortBy, query?.sortOrder);

  const [projects, totalCount] = await Promise.all([
    prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy,
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.project.count({ where }),
  ]);

  const mapped = projects.map(({ variations, ...project }) => {
    const milestoneCount = project.milestones.length;
    const completedMilestoneCount = project.milestones.filter((milestone) => milestone.status === "DONE").length;
    const progressPercent = milestoneCount === 0 ? 0 : Math.round((completedMilestoneCount / milestoneCount) * 100);
    const approvedVariationSpend = variations
      .filter((variation) => variation.status === "APPROVED")
      .reduce((sum, variation) => sum + Number(variation.cost), 0);

    return {
      ...project,
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
    };
  });

  return {
    items: mapped,
    page: safePage,
    limit: safeLimit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
  };
}

/**
 * Retrieves a paginated list of projects.
 *
 * This function is intended for project listing pages and automatically
 * calculates additional project statistics such as progress percentage,
 * milestone counts and approved variation spend.
 *
 * If an error occurs, an empty paginated result is returned instead of throwing.
 *
 * @param query - Pagination, search, filtering and sorting options.
 * @returns Paginated project list.
 */
export async function getProjects(query?: ProjectListQuery): Promise<PaginatedProjectsResult> {
  try {
    return await getProjectsPage(query);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return {
      items: [],
      page: query?.page ?? 1,
      limit: query?.limit ?? 12,
      totalCount: 0,
      totalPages: 1,
    };
  }
}

/**
 * Retrieves a lightweight paginated list of projects suitable for searchable
 * dropdowns, autocomplete components and lookup dialogs.
 *
 * Only the project ID, name and location are returned.
 *
 * @param page - Page number.
 * @param limit - Maximum number of items per page.
 * @param query - Optional search query matching project name or location.
 * @returns Paginated lookup result.
 */
export async function getProjectsForLookup(page = 1, limit = defaultLookupPageSize, query?: string): Promise<PaginatedProjectLookupResult> {
  try {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : defaultLookupPageSize;
    const search = normalizeSearch(query);

    const where: Prisma.ProjectWhereInput | undefined = search.length > 0
      ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
      : undefined;

    const [items, totalCount] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        select: {
          id: true,
          name: true,
          location: true,
        },
        orderBy: { name: "asc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.project.count({ where }),
    ]);

    return {
      items: items as ProjectLookupItem[],
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    };
  } catch (error) {
    console.error("Error fetching projects for lookup:", error);
    return {
      items: [],
      page: 1,
      limit,
      totalCount: 0,
      totalPages: 1,
    };
  }
}

/**
 * Retrieves the complete details for a single project.
 *
 * The returned object includes:
 * - Customer
 * - Site manager
 * - Milestones
 * - Tradie schedules
 * - Site updates
 * - Activity logs
 * - Variations
 * - Files
 * - Materials
 *
 * Decimal database values are converted into strings to ensure safe
 * serialization across the server/client boundary.
 *
 * @param projectId - Project ID.
 * @returns The complete project details, or `null` if the project does not exist.
 *
 * @throws Re-throws any unexpected database errors.
 */
export async function getProjectById(projectId: string): Promise<ProjectDetail | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: projectDetailInclude,
    });

    if (!project) {
      return null;
    }

    return {
      ...project,
      materials: project.materials.map((material) => ({
        ...material,
        unitCost: material.unitCost.toString(),
        totalCost: material.totalCost.toString(),
      })),
      lotSize: project.lotSize?.toString() ?? undefined,
      totalBudget: project.totalBudget.toString(),
      spent: project.spent.toString(),
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
            hourlyRate: schedule.tradie.hourlyRate?.toString(),
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
          hourlyRate: schedule.tradie.hourlyRate?.toString(),
          rating: schedule.tradie.rating?.toString(),
        },
        milestone: schedule.milestone ? {
          ...schedule.milestone,
          budget: schedule.milestone.budget.toString(),
          spend: schedule.milestone.spend?.toString(),
        } : undefined,
      })),
    };
  } catch (error) {
    console.error("Error fetching project by ID:", error);
    throw error;
  }
}

/**
 * Retrieves every project in the system for reporting and export operations.
 *
 * Each project includes computed statistics including:
 * - Progress percentage
 * - Milestone counts
 * - Approved variation spend
 *
 * Decimal values are converted into strings for serialization.
 *
 * If an error occurs, an empty array is returned.
 *
 * @returns Complete collection of export-ready projects.
 */
export async function getAllProjectsForExport(): Promise<ProjectWithStats[]> {
  try {
    const projects = await prisma.project.findMany({
      include: projectInclude,
    });

    const mapped = projects.map(({ variations, ...project }) => {
      const milestoneCount = project.milestones.length;
      const completedMilestoneCount = project.milestones.filter((milestone) => milestone.status === "DONE").length;
      const progressPercent = milestoneCount === 0 ? 0 : Math.round((completedMilestoneCount / milestoneCount) * 100);
      const approvedVariationSpend = variations
        .filter((variation) => variation.status === "APPROVED")
        .reduce((sum, variation) => sum + Number(variation.cost), 0);

      return {
        ...project,
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
      };
    });

    return mapped;
  } catch (error) {
    console.error("Error fetching projects for export:", error);
    return [];
  }
}

type ProjectKPIResult = {
  total_active: bigint;
  on_track: bigint;
  needs_attention: bigint;
  delayed: bigint;
};

/**
 * Retrieves dashboard KPI statistics for all projects.
 *
 * Returns counts for:
 * - Total active projects
 * - Projects on track
 * - Projects needing attention
 * - Delayed projects
 *
 * Uses a raw SQL query for maximum performance.
 *
 * If the query fails, all KPI values default to zero.
 *
 * @returns Project dashboard KPIs.
 */
export async function getProjectKPIs(): Promise<ProjectKPIs> {
  try {
    const [result] = await prisma.$queryRaw<ProjectKPIResult[]>`
            SELECT
                COUNT(*) FILTER (
                    WHERE status != 'COMPLETED'
                ) AS total_active,

                COUNT(*) FILTER (
                    WHERE status = 'ON_TRACK'
                ) AS on_track,

                COUNT(*) FILTER (
                    WHERE status = 'NEEDS_ATTENTION'
                ) AS needs_attention,

                COUNT(*) FILTER (
                    WHERE status = 'DELAYED'
                ) AS delayed
            FROM "Project"
        `;

    return {
      totalActive: Number(result.total_active),
      onTrack: Number(result.on_track),
      needsAttention: Number(result.needs_attention),
      delayed: Number(result.delayed),
    };
  } catch (error) {
    console.error("Error fetching project KPIs:", error);

    return {
      totalActive: 0,
      onTrack: 0,
      needsAttention: 0,
      delayed: 0,
    };
  }
}

/**
 * Retrieves a cached paginated list of projects.
 *
 * Uses Next.js Cache Components to cache project listings and associates the
 * result with the `projects` cache tag for selective invalidation.
 *
 * @param query - Pagination, filtering and sorting options.
 * @returns Cached paginated project list.
 */
export async function getCachedProjects(query?: ProjectListQuery) {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  return getProjects(query);
}

/**
 * Retrieves cached details for a single project.
 *
 * The cached result is tagged using the project's unique cache tag,
 * allowing individual project invalidation after updates.
 *
 * @param id - Project ID.
 * @returns Cached project details or `null` if not found.
 */
export async function getCachedProjectById(id: string) {
  "use cache";

  cacheTag(`project-${id}`);
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectById(id);
}

/**
 * Retrieves cached project dashboard KPIs.
 *
 * KPI values are cached using the shared `projects` cache tag and are
 * automatically refreshed when project data is revalidated.
 *
 * @returns Cached project KPI statistics.
 */
export async function getCachedProjectKPIs() {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectKPIs();
}

/**
 * Retrieves a cached paginated project lookup list.
 *
 * Intended for autocomplete inputs and searchable project selectors where
 * only basic project information is required.
 *
 * Uses a short-lived cache to keep lookup results responsive while allowing
 * newly created projects to appear quickly.
 *
 * @param page - Page number.
 * @param limit - Maximum number of results per page.
 * @param query - Optional search term.
 * @returns Cached paginated lookup result.
 */
export async function getCachedProjectsForLookup(
  page = 1,
  limit = defaultLookupPageSize,
  query?: string,
) {
  "use cache";

  cacheTag("projects");

  // equivalent to revalidate: 120
  cacheLife(CACHE_PROFILES.SHORT);

  return getProjectsForLookup(page, limit, query);
}