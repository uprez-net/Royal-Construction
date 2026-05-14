"use server";

import { Prisma, ProjectStatus } from "@prisma/client";
import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { ProjectDetail, ProjectKPIs, ProjectWithStats } from "@/types/project";

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

const projectInclude = {
  customer: true,
  siteManager: true,
  milestones: {
    select: {
      status: true,
    },
  },
} as const;

const projectDetailInclude = {
  customer: true,
  siteManager: true,
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
} as const;

const defaultPageSize = 12;

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
        { name: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { siteManager: { name: { contains: search, mode: "insensitive" } } },
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

  const mapped = projects.map((project) => {
    const milestoneCount = project.milestones.length;
    const completedMilestoneCount = project.milestones.filter((milestone) => milestone.status === "DONE").length;
    const progressPercent = milestoneCount === 0 ? 0 : Math.round((completedMilestoneCount / milestoneCount) * 100);

    return {
      ...project,
      totalBudget: project.totalBudget.toString(),
      spent: project.spent.toString(),
      milestoneCount,
      completedMilestoneCount,
      progressPercent,
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
  return getProjectsPage(query);
}

export async function getProjectById(projectId: string): Promise<ProjectDetail | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: projectDetailInclude,
  });

  if (!project) {
    return null;
  }

  return {
    ...project,
    totalBudget: project.totalBudget.toString(),
    spent: project.spent.toString(),
    siteUpdates: project.siteUpdates
      .filter((siteUpdate) => siteUpdate.milestone !== null)
      .map((siteUpdate) => ({
        ...siteUpdate,
        milestone: siteUpdate.milestone!,
      })),
    milestones: project.milestones.map((milestone) => ({
      ...milestone,
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
      milestone: schedule.milestone ?? undefined,
    })),
  };
}

export async function getProjectKPIs(): Promise<ProjectKPIs> {
  const [totalActive, onTrack, needsAttention, delayed] = await Promise.all([
    prisma.project.count({ where: { status: ProjectStatus.ACTIVE } }),
    prisma.project.count({ where: { status: ProjectStatus.ON_TRACK } }),
    prisma.project.count({ where: { status: ProjectStatus.NEEDS_ATTENTION } }),
    prisma.project.count({ where: { status: ProjectStatus.DELAYED } }),
  ]);

  return { totalActive, onTrack, needsAttention, delayed };
}

export const getCachedProjects = unstable_cache(
  async (query?: ProjectListQuery) => getProjects(query),
  ["projects"],
  { tags: ["projects"], revalidate: false },
);

export const getCachedProjectById = unstable_cache(
  async (id: string) => getProjectById(id),
  ["projects-detail"],
  { tags: ["projects", "milestones"], revalidate: false },
);

export const getCachedProjectKPIs = unstable_cache(
  async () => getProjectKPIs(),
  ["projects-kpis"],
  { tags: ["projects"], revalidate: false },
);
