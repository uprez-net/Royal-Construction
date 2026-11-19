import { MilestoneStatus, ProjectStatus, Role } from "@prisma/client";

import { sydneyEndOfDay, sydneyToday } from "@/lib/dates/sydney";

import { projectReadScope } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";

// What a site manager's dashboard is built from: the live projects' progress by
// manager, and the activities that are due. Neither carries a dollar figure and
// neither reads a lead — that is the point of this module being separate from
// the sales dashboard in `lib/data/dashboard.ts`.

/**
 * A project that is being built, as against drafted, in compliance, or done.
 * The same four the "Active projects" table's status filter and the Needs
 * Attention rule treat as the build.
 */
const BUILDING: ProjectStatus[] = [
  ProjectStatus.ACTIVE,
  ProjectStatus.ON_TRACK,
  ProjectStatus.NEEDS_ATTENTION,
  ProjectStatus.DELAYED,
];

/** Settled either way, as `withProjectStats` counts progress. */
const SETTLED: MilestoneStatus[] = [
  MilestoneStatus.DONE,
  MilestoneStatus.NOT_REQUIRED,
];

function requireStaff(principal: DomainPrincipal, what: string): void {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(`${what} is for members of staff.`);
  }
}

export type SiteManagerPerformance = {
  readonly id: string;
  readonly name: string;
  /** Projects of theirs that are being built. */
  readonly projectsCount: number;
  readonly milestonesCompleted: number;
  readonly milestonesTotal: number;
};

/**
 * Each site manager's building projects and how far through them they are.
 *
 * Everyone who holds the role is listed, projects or not, and so is anyone else
 * a project has been assigned to: an ADMIN can be a project's site manager, and
 * leaving them out would make a project's manager vanish from the table.
 * Computed from the records. The dashboard used to draw hours a week and a star
 * rating from a hard-coded list; nothing records either.
 */
export async function listSiteManagerPerformance(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<SiteManagerPerformance[]> {
  requireStaff(principal, "Site manager performance");

  const managers = await db.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      siteManagerProjects: {
        select: { milestones: { select: { status: true } } },
        where: { status: { in: BUILDING } },
      },
    },
    where: {
      OR: [
        { role: Role.SITE_MANAGER },
        { siteManagerProjects: { some: { status: { in: BUILDING } } } },
      ],
    },
  });

  return managers.map((manager) => {
    const milestones = manager.siteManagerProjects.flatMap(
      (project) => project.milestones,
    );
    return {
      id: manager.id,
      milestonesCompleted: milestones.filter((milestone) =>
        SETTLED.includes(milestone.status),
      ).length,
      milestonesTotal: milestones.length,
      name: manager.name,
      projectsCount: manager.siteManagerProjects.length,
    };
  });
}

export type ProjectFollowUp = {
  /** The activity's id: one project has many, and this is the row's key. */
  readonly id: string;
  readonly customerName: string;
  readonly projectName: string;
  readonly description: string;
  readonly dueAt: Date;
};

/**
 * Activities on building projects that are due today or already overdue.
 *
 * The follow-ups a site manager owns. There is no project follow-up record —
 * `LeadTask` belongs to a lead, and a lead's follow-up is the sales side's —
 * so the thing a project owes somebody is its next activity falling due. Top
 * level only: a sub-activity rolls up into its parent, which is what the
 * project's own Milestones tab lists as the stage.
 *
 * "Today" is Sydney's, not the server's: Vercel runs on UTC, where the day
 * ends ten hours before the office's does.
 */
export async function listProjectFollowUpsDue(
  principal: DomainPrincipal,
  input: { readonly now?: Date },
  db: DomainDb,
): Promise<ProjectFollowUp[]> {
  requireStaff(principal, "Project follow-ups");

  const endOfToday = sydneyEndOfDay(sydneyToday(input.now));
  const milestones = await db.milestone.findMany({
    orderBy: [{ targetDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      project: {
        select: {
          customer: { select: { name: true } },
          location: true,
          name: true,
        },
      },
      projectStage: true,
      targetDate: true,
    },
    where: {
      parentId: null,
      project: { ...projectReadScope(principal), status: { in: BUILDING } },
      status: { in: [MilestoneStatus.PENDING, MilestoneStatus.ACTIVE] },
      targetDate: { lte: endOfToday },
    },
  });

  return milestones.map((milestone) => ({
    customerName: milestone.project.customer.name,
    description: milestone.name,
    dueAt: milestone.targetDate,
    id: milestone.id,
    projectName: milestone.project.name,
  }));
}
