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
          company: true,
          tradeType: true,
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

function normalizeSearch(search?: string) {
  return search?.trim() ?? "";
}

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

async function getProjectsPage(query?: ProjectListQuery): Promise<PaginatedProjectsResult> {
  const safePage = Number.isFinite(query?.page ?? 1) && (query?.page ?? 1) > 0 ? Math.floor(query?.page ?? 1) : 1;
  const safeLimit = Number.isFinite(query?.limit ?? defaultPageSize) && (query?.limit ?? defaultPageSize) > 0
    ? Math.min(Math.floor(query?.limit ?? defaultPageSize), 100)
    : defaultPageSize;
  const where = buildProjectWhere(query);
  const orderBy = buildProjectOrderBy(query?.sortBy, query?.sortOrder);

  const [projects, totalCount] = await prisma.$transaction([
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

export async function getProjects(query?: ProjectListQuery): Promise<PaginatedProjectsResult> {
  try {
    return getProjectsPage(query);
  } catch (error) {
    console.error("Error fetching projects:", error);
    throw new Error(error instanceof Error ? error.message : "Error fetching projects");
  }
}

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
    throw new Error(error instanceof Error ? error.message : "Error fetching projects for lookup");
  }
}

export async function getProjectById(projectId: string): Promise<ProjectDetail> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: projectDetailInclude,
    });

    if (!project) {
      throw new Error("Project not found");
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
    throw new Error(error instanceof Error ? error.message : "Error fetching project by ID");
  }
}

export async function getProjectKPIs(): Promise<ProjectKPIs> {
  try {
    const [totalActive, onTrack, needsAttention, delayed] = await Promise.all([
      prisma.project.count({ where: { status: { not: ProjectStatus.COMPLETED } } }),
      prisma.project.count({ where: { status: ProjectStatus.ON_TRACK } }),
      prisma.project.count({ where: { status: ProjectStatus.NEEDS_ATTENTION } }),
      prisma.project.count({ where: { status: ProjectStatus.DELAYED } }),
    ]);

    return { totalActive, onTrack, needsAttention, delayed };
  } catch (error) {
    console.error("Error fetching project KPIs:", error);
    throw new Error(error instanceof Error ? error.message : "Error fetching project KPIs");
  }
}

export async function getCachedProjects(query?: ProjectListQuery) {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  return getProjects(query);
}

export async function getCachedProjectById(id: string) {
  "use cache";

  cacheTag(`project-${id}`);
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectById(id);
}

export async function getCachedProjectKPIs() {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectKPIs();
}

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