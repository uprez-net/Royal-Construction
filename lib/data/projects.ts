"use server";

import { ProjectStatus, Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";

import prisma from "@/lib/prisma";

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

export type ProjectWithStats = Prisma.ProjectGetPayload<{
  include: typeof projectInclude;
}> & {
  milestoneCount: number;
  completedMilestoneCount: number;
  progressPercent: number;
};

export type ProjectDetail = Prisma.ProjectGetPayload<{
  include: typeof projectDetailInclude;
}>;

export type ProjectKPIs = {
  totalActive: number;
  onTrack: number;
  needsAttention: number;
  delayed: number;
};

export async function getProjects(filters?: { status?: ProjectStatus }): Promise<ProjectWithStats[]> {
  const projects = await prisma.project.findMany({
    where: filters?.status ? { status: filters.status } : undefined,
    include: projectInclude,
    orderBy: { createdAt: "desc" },
  });

  return projects.map((project) => {
    const milestoneCount = project.milestones.length;
    const completedMilestoneCount = project.milestones.filter((milestone) => milestone.status === "DONE").length;
    const progressPercent = milestoneCount === 0 ? 0 : Math.round((completedMilestoneCount / milestoneCount) * 100);

    return {
      ...project,
      milestoneCount,
      completedMilestoneCount,
      progressPercent,
    };
  });
}

export async function getProjectById(id: string): Promise<ProjectDetail | null> {
  return prisma.project.findUnique({
    where: { id },
    include: projectDetailInclude,
  });
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
  async (status?: ProjectStatus) => getProjects(status ? { status } : undefined),
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
