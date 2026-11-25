import { MilestoneStatus, Role } from "@prisma/client";

import { fromZonedTime, toZonedTime } from "date-fns-tz";

import { SYDNEY_TZ, sydneyEndOfDay, sydneyToday } from "@/lib/dates/sydney";
import { duenessOf } from "@/lib/projects/milestone-ledger";

import { projectReadScope } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import {
  BUILDING_PROJECT_STATUSES,
  milestoneEndDate,
} from "./milestone-schedule";

// What a site manager's dashboard is built from: the live projects' progress by
// manager, and the activities that are due. Neither carries a dollar figure and
// neither reads a lead — that is the point of this module being separate from
// the sales dashboard in `lib/data/dashboard.ts`.

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
        where: { status: { in: [...BUILDING_PROJECT_STATUSES] } },
      },
    },
    where: {
      OR: [
        { role: Role.SITE_MANAGER },
        {
          siteManagerProjects: {
            some: { status: { in: [...BUILDING_PROJECT_STATUSES] } },
          },
        },
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
 * "Due" is the Milestones tab's own rule (`duenessOf`), the one the project's
 * overdue count uses: an activity is due on its estimated completion
 * (`milestoneEndDate`: its actual start, or its planned start, plus its
 * duration). Only an activity under way is listed, as only one under way can
 * be overdue (`openOverdueDays`): a pending activity's dates run from a start
 * nobody has reached, and listing it here put "12 days overdue" on work that
 * was never late.
 *
 * "Today" is Sydney's, not the server's: Vercel runs on UTC, where the day
 * ends ten hours before the office's does. Both dates are moved onto Sydney's
 * wall clock before the calendar days are counted, as the overdue count does.
 */
export async function listProjectFollowUpsDue(
  principal: DomainPrincipal,
  input: { readonly now?: Date },
  db: DomainDb,
): Promise<ProjectFollowUp[]> {
  requireStaff(principal, "Project follow-ups");

  const now = input.now ?? new Date();
  const endOfToday = sydneyEndOfDay(sydneyToday(now));
  const milestones = await db.milestone.findMany({
    orderBy: [{ targetDate: "asc" }, { id: "asc" }],
    select: {
      estimatedDays: true,
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
      startDate: true,
      targetDate: true,
    },
    where: {
      // A narrowing only: an activity cannot finish before it starts, so one
      // that has not started (or is not planned to) by tonight is not due.
      OR: [
        { startDate: { lte: endOfToday } },
        { startDate: null, targetDate: { lte: endOfToday } },
      ],
      parentId: null,
      project: {
        ...projectReadScope(principal),
        status: { in: [...BUILDING_PROJECT_STATUSES] },
      },
      status: MilestoneStatus.ACTIVE,
    },
  });

  const today = toZonedTime(now, SYDNEY_TZ);
  const due = milestones.flatMap((milestone) => {
    const timing = {
      estimatedDays: milestone.estimatedDays,
      startDate: milestone.startDate
        ? toZonedTime(milestone.startDate, SYDNEY_TZ)
        : null,
      targetDate: toZonedTime(milestone.targetDate, SYDNEY_TZ),
    };
    const dueness = duenessOf(timing, today);
    if (dueness.kind !== "overdue" && dueness.kind !== "today") return [];
    return [
      {
        customerName: milestone.project.customer.name,
        description: milestone.name,
        // Worked out on the wall clock and brought back to an instant, so a
        // daylight-saving change cannot move it onto the day before.
        dueAt: fromZonedTime(milestoneEndDate(timing), SYDNEY_TZ),
        id: milestone.id,
        projectName: milestone.project.name,
      },
    ];
  });
  // Most overdue first. The query is ordered by planned start, which is not
  // the order activities fall due in once their durations differ.
  return due.sort(
    (a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id),
  );
}
