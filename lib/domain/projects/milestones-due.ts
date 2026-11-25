import { MilestoneStatus, ProjectStatus, type Prisma } from "@prisma/client";
import { sydneyStartOfDay, sydneyToday } from "@/lib/dates/sydney";
import type {
  SydneyDayRange,
  SydneyDayRangeInput,
} from "@/lib/dates/day-range";
import { resolveDayRange } from "../day-range";
import { projectReadScope } from "../access/projects";
import { BUILDING_PROJECT_STATUSES } from "./milestone-schedule";
import type { DomainDb } from "../db";
import type { DomainPrincipal } from "../principal";

/**
 * A job someone is working on: not finished, and not a draft nobody has
 * started. The office digest's "Jobs in progress" and the milestone read below
 * share it, so a brief and the snapshot count the same jobs (#618).
 */
export const NOT_IN_PROGRESS_PROJECT_STATUSES = [
  ProjectStatus.COMPLETED,
  ProjectStatus.DRAFT,
] as const;

export function projectInProgressWhere(): Prisma.ProjectWhereInput {
  return { status: { notIn: [...NOT_IN_PROGRESS_PROJECT_STATUSES] } };
}

/** A milestone still to do: not done and not waived. */
const OPEN_MILESTONE_STATUSES = [
  MilestoneStatus.PENDING,
  MilestoneStatus.ACTIVE,
] as const;

export type DueMilestone = {
  readonly milestoneId: string;
  readonly name: string;
  readonly parentName: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: MilestoneStatus;
  readonly targetDate: Date;
  readonly startDate: Date | null;
};

export type MilestonesDue = {
  readonly range: SydneyDayRange;
  /** Open milestones whose target date falls in the window. */
  readonly due: { readonly total: number; readonly items: DueMilestone[] };
  /**
   * Milestones under way, on jobs being built, whose target date passed
   * before today. Empty if not asked.
   */
  readonly overdue: { readonly total: number; readonly items: DueMilestone[] };
};

/**
 * Milestones due in a window, and those already overdue, across every job in
 * progress the caller may see (#618).
 *
 * There was no such read, so a brief walked `get_project` one project at a
 * time (389 calls in 14 days in production) and reported "Active project
 * review unavailable" when it ran out of steps. Dates are returned as dates;
 * "overdue" is decided against the Sydney day the read is made.
 */
export async function listMilestonesDue(
  principal: DomainPrincipal,
  input: SydneyDayRangeInput & {
    readonly includeOverdue: boolean;
    readonly limit: number;
  },
  db: DomainDb,
  now: Date = new Date(),
): Promise<MilestonesDue> {
  const range = resolveDayRange(input, now);
  const project: Prisma.ProjectWhereInput = {
    ...projectInProgressWhere(),
    ...projectReadScope(principal),
  };
  const open = { in: [...OPEN_MILESTONE_STATUSES] };
  const dueWhere: Prisma.MilestoneWhereInput = {
    project,
    status: open,
    targetDate: { gte: range.from, lte: range.to },
  };
  // Overdue is `openOverdueDays`' rule: only an activity under way, on a
  // project being built. A job waiting on its certifier has planned dates in
  // the past on every activity, and none of them is late.
  const overdueWhere: Prisma.MilestoneWhereInput = {
    project: {
      ...projectReadScope(principal),
      status: { in: [...BUILDING_PROJECT_STATUSES] },
    },
    status: MilestoneStatus.ACTIVE,
    targetDate: { lt: sydneyStartOfDay(sydneyToday(now)) },
  };
  const select = {
    id: true,
    name: true,
    parentMilestone: { select: { name: true } },
    project: { select: { id: true, name: true } },
    startDate: true,
    status: true,
    targetDate: true,
  } as const;
  const orderBy: Prisma.MilestoneOrderByWithRelationInput[] = [
    { targetDate: "asc" },
    { order: "asc" },
  ];

  const [dueTotal, dueRows, overdueTotal, overdueRows] = await Promise.all([
    db.milestone.count({ where: dueWhere }),
    db.milestone.findMany({
      orderBy,
      select,
      take: input.limit,
      where: dueWhere,
    }),
    input.includeOverdue
      ? db.milestone.count({ where: overdueWhere })
      : Promise.resolve(0),
    input.includeOverdue
      ? db.milestone.findMany({
          orderBy,
          select,
          take: input.limit,
          where: overdueWhere,
        })
      : Promise.resolve([]),
  ]);

  const toItem = (row: (typeof dueRows)[number]): DueMilestone => ({
    milestoneId: row.id,
    name: row.name,
    parentName: row.parentMilestone?.name ?? null,
    projectId: row.project.id,
    projectName: row.project.name,
    startDate: row.startDate,
    status: row.status,
    targetDate: row.targetDate,
  });
  return {
    due: { items: dueRows.map(toItem), total: dueTotal },
    overdue: { items: overdueRows.map(toItem), total: overdueTotal },
    range,
  };
}
