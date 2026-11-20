import {
  MilestoneStatus,
  Prisma,
  ProjectStage,
  ProjectStatus,
  type Milestone,
} from "@prisma/client";
import { v4 as randomUUID } from "uuid";

import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";

import {
  authorizeMilestoneRecording,
  authorizeProject,
  authorizeProjectRecording,
  canBookTradies,
  canManageProject,
  canSeeProjectFinancials,
} from "../access/projects";
import type { DomainDb } from "../db";
import { HIDDEN_AMOUNT, hideMilestoneFinancials } from "./financial-redaction";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
  DomainAuthorizationError,
} from "../errors";
import {
  resolveDueStageClaim,
  type DueStageClaim,
} from "../invoices/stage-claim";
import type { DomainPrincipal } from "../principal";

import { createActivityLogEntry } from "@/types/activityLog";

import { logActionOrThrow } from "../audit/action-log";
import { attributionUserId } from "../principal";

import {
  milestoneEndDate,
  milestoneTargetDates,
  replanFollowingActivities,
  STARTED_MILESTONE_STATUSES,
} from "./milestone-schedule";
import {
  settledBookingStatus,
  tradieScheduleSpend,
} from "../tradies/lifecycle";
import { settleMilestoneBookings } from "../tradies/settlement";
import { sydneyDateOnly, sydneyToday } from "@/lib/dates/sydney";

// Milestones: creation, ordering, the status state machine, the parent
// roll-up, and what settling one means for the project it belongs to.
//
// The App (`lib/data/milestones.ts`) and Eve
// (`agent/lib/project-operations.ts`) each had their own, and they disagreed
// about almost everything that matters:
//
//   - **Ordering.** The App inserted after the parent and shifted every
//     milestone below; Eve appended at the end with `last.order + 1` and
//     shifted nothing, so a milestone added to a parent through the agent
//     landed at the bottom of the project instead of under the activity it
//     belongs to.
//   - **The parent belongs to the project.** Eve checked it. The App did not,
//     so a `parentId` from another project attached a milestone across the
//     boundary. Eve's check is kept; it is the stricter one.
//   - **Everything downstream of settling a milestone.** This is the one that
//     costs money. The App's update rolls the parent up when its last child
//     settles, recomputes `Project.spent` from the root milestones, marks the
//     project COMPLETED when nothing is pending, and raises the progress claim
//     for a stage that just finished. Eve's `updateMilestoneDirect` did
//     **none** of it: it wrote the milestone row and stopped. Completing the
//     last activity of a stage through the agent left the project's spend
//     stale, the parent milestone open, and — the expensive part — the
//     customer's progress claim unraised, with nothing anywhere saying so.
//
// One command now. The database writes all happen here, in one transaction.
// The effects that reach outside the database — the Xero claim, the Novu
// notification, the cache tags — are reported in the outcome and performed by
// whichever adapter called, because they are post-commit work and a Xero
// outage must not roll back a milestone the operator already marked done.

import {
  allowedMilestoneTransitions,
  shouldCompleteParent,
} from "./milestone-status";
export { allowedMilestoneTransitions } from "./milestone-status";

export type CreateMilestoneInput = {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string;
  readonly targetDate: string;
  readonly budget: number;
  readonly parentId?: string | null;
  readonly projectStage: ProjectStage;
};

/**
 * The created row, with its Decimals serialized.
 *
 * The whole row rather than a summary: the Milestones tab renders the new
 * activity straight from the response, and a narrower shape would have the
 * adapter re-reading what it just wrote to fill in `description` and `order`.
 */
export type CreatedMilestone = Omit<Milestone, "budget" | "spend"> & {
  readonly budget: string;
  readonly spend: string | undefined;
};

/**
 * Where a new milestone goes in the project's order.
 *
 * With a parent: immediately after that parent's last existing child, so the
 * activity appears under the thing it hangs off. Without one: after the last
 * milestone already in the same contract stage, falling back to the end of the
 * project when the stage is empty.
 *
 * **The no-parent case is a deliberate fix, flagged rather than assumed.** The
 * App computed `count(projectId, projectStage) + 1` and then shifted every
 * milestone from that position up — an insertion point derived from how many
 * milestones share the stage, applied to a project-wide ordering. On a
 * template-seeded project that put a new Final-stage activity somewhere in the
 * middle of the Slab stage and renumbered two dozen unrelated rows to do it.
 * Ordering is display-only here (the claim ledger groups by a root's
 * `projectStage`, not by `order`), so this changes where a manually added
 * activity appears and nothing about what is claimed.
 */
async function resolveMilestoneOrder(
  input: { projectId: string; parentId: string | null; stage: ProjectStage },
  db: DomainDb,
): Promise<number> {
  if (input.parentId) {
    const parent = await db.milestone.findFirst({
      where: { id: input.parentId, projectId: input.projectId },
      select: {
        order: true,
        status: true,
        childrenMilestones: {
          select: { order: true },
          orderBy: { order: "asc" },
        },
      },
    });
    if (!parent) {
      throw new DomainNotFoundError(
        "The parent milestone does not belong to this project.",
      );
    }
    const children = parent.childrenMilestones;
    return children.length > 0
      ? children[children.length - 1].order + 1
      : parent.order + 1;
  }

  const lastInStage = await db.milestone.findFirst({
    where: { projectId: input.projectId, projectStage: input.stage },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  if (lastInStage) return lastInStage.order + 1;

  const lastInProject = await db.milestone.findFirst({
    where: { projectId: input.projectId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return (lastInProject?.order ?? 0) + 1;
}

/**
 * Add a milestone to a project.
 *
 * Opens no transaction of its own: it shifts a run of sibling rows and then
 * inserts, which has to be atomic, so the caller supplies the transaction. The
 * App action and the Eve tool both already have one.
 */
export async function createMilestone(
  principal: DomainPrincipal,
  input: CreateMilestoneInput,
  db: DomainDb,
): Promise<CreatedMilestone> {
  await authorizeProject(principal, input.projectId, db);

  if (!(input.budget >= 0)) {
    throw new DomainValidationError(
      "Budget must be a non-negative number.",
      "budget",
    );
  }
  const targetDate = new Date(input.targetDate);
  if (Number.isNaN(targetDate.getTime())) {
    throw new DomainValidationError(
      "targetDate is not a calendar date.",
      "targetDate",
    );
  }

  const parentId = input.parentId?.trim() || null;
  const order = await resolveMilestoneOrder(
    { parentId, projectId: input.projectId, stage: input.projectStage },
    db,
  );

  // An active parent goes back to PENDING: it cannot be under way while a new
  // activity beneath it has not started.
  if (parentId) {
    await db.milestone.updateMany({
      where: { id: parentId, status: MilestoneStatus.ACTIVE },
      data: { status: MilestoneStatus.PENDING },
    });
  }

  // Make room. Descending order so each row moves into a slot that is already
  // free — the unique-ish ordering never collides mid-shift.
  const toShift = await db.milestone.findMany({
    where: { projectId: input.projectId, order: { gte: order } },
    orderBy: { order: "desc" },
    select: { id: true, order: true },
  });
  for (const milestone of toShift) {
    await db.milestone.update({
      where: { id: milestone.id },
      data: { order: milestone.order + 1 },
    });
  }

  const created = await db.milestone.create({
    data: {
      name: input.name,
      description: input.description,
      targetDate,
      budget: new Prisma.Decimal(input.budget),
      order,
      projectId: input.projectId,
      parentId,
      projectStage: input.projectStage,
    },
  });

  return {
    ...created,
    budget: created.budget.toString(),
    spend: created.spend?.toString(),
  };
}

export type UpdateMilestoneInput = {
  readonly milestoneId: string;
  readonly status: MilestoneStatus;
  readonly targetDate?: string;
  readonly startDate?: string;
  readonly actualDate?: string;
  readonly spend?: number;
};

export type UpdatedMilestone = Omit<Milestone, "budget" | "spend"> & {
  readonly budget: string;
  readonly spend: string | undefined;
  /** What it was before this call, for the history entry and the message. */
  readonly previousStatus: MilestoneStatus;
};

export type UpdateMilestoneOutcome = {
  readonly parentUpdates: readonly {
    id: string;
    status: MilestoneStatus;
    spend?: string;
    actualDate?: Date;
    startDate?: Date;
  }[];
  readonly milestone: UpdatedMilestone;
  /** True when this call moved the status, not just the dates or the spend. */
  readonly statusChanged: boolean;
  /** The parent this call rolled up, if settling the milestone closed one. */
  readonly rolledUpParentId: string | null;
  /** The status the project was moved to, or null when it was left alone. */
  readonly projectStatus: ProjectStatus | null;
  /** `Project.spent`, recomputed from the root milestones. */
  readonly projectSpent: string;
  readonly siteManagerId: string | null;
  /**
   * A progress claim this settlement made due, for the adapter to raise
   * post-commit. Null when no stage finished, the stage was entirely waived,
   * or a claim already exists.
   */
  readonly stageClaim: DueStageClaim | null;
  /**
   * The project's new start date, when this update started the first activity
   * and moved the start (and so every target date) to the day work began.
   * Null otherwise.
   */
  readonly projectStartDate: Date | null;
  /**
   * Open activities re-planned because this update closed an activity: each
   * one after it in the sequence now starts the day it closed (issue #422).
   * Empty when nothing moved.
   */
  readonly replannedActivities: readonly {
    readonly id: string;
    readonly targetDate: Date;
  }[];
  /**
   * Bookings this update settled: completed or cancelled because the milestone
   * they were for (or the parent it rolled up) was settled. Empty otherwise.
   */
  readonly settledBookings: {
    readonly completed: readonly string[];
    readonly cancelled: readonly string[];
  };
};

/**
 * The spend a caller who cannot see prices gets to record.
 *
 * Completing an activity needs a spend, and the screen works it out from the
 * prices on the bookings and sends it. Someone who may not see those prices is
 * handed none, so their screen would work out nothing and send $0 — and $0
 * would be written to the activity and rolled up into the project's spend. So
 * for them the figure is worked out here, from the same bookings the same way
 * (`tradieScheduleSpend`, each booking priced at the status completion is about
 * to give it), and whatever they sent is ignored. A caller who sees prices
 * keeps entering and confirming their own.
 *
 * Only on the way INTO done. An activity that is already done keeps the spend
 * it has: correcting its completion date is not a reason to re-price it, and
 * the office may have typed a figure the bookings do not explain (an activity
 * with no bookings at all would otherwise be re-priced to $0).
 */
async function withServerSideSpend(
  principal: DomainPrincipal,
  input: UpdateMilestoneInput,
  stored: { readonly status: MilestoneStatus; readonly spend: unknown },
  db: DomainDb,
): Promise<UpdateMilestoneInput> {
  if (canSeeProjectFinancials(principal)) return input;
  if (input.status !== MilestoneStatus.DONE) {
    return { ...input, spend: undefined };
  }
  if (stored.status === MilestoneStatus.DONE && stored.spend !== null) {
    return { ...input, spend: Number(stored.spend) };
  }
  const bookings = await db.tradieSchedule.findMany({
    select: {
      durationDays: true,
      quotedPrice: true,
      requiresQuote: true,
      status: true,
      tradie: { select: { lastQuotedPrice: true, lastQuotedPriceUnit: true } },
    },
    where: { milestoneId: input.milestoneId },
  });
  const spend = bookings.reduce(
    (total, booking) =>
      total
      + tradieScheduleSpend({
        ...booking,
        status: settledBookingStatus(booking.status, "DONE") ?? booking.status,
        tradie: {
          lastQuotedPrice: booking.tradie.lastQuotedPrice?.toString() ?? null,
          lastQuotedPriceUnit: booking.tradie.lastQuotedPriceUnit,
        },
      }),
    0,
  );
  return { ...input, spend };
}

/**
 * The intrinsic rules of a milestone update, independent of what is stored.
 *
 * Pure, so the App's Zod schema (`utils/validators/milestone.ts`, which
 * enforces exactly these) and this command cannot drift apart: the transport
 * catches it early for a nicer form error, the rule catches it whoever calls.
 */
export function assertMilestoneFieldsForStatus(
  input: Pick<
    UpdateMilestoneInput,
    "status" | "startDate" | "actualDate" | "spend"
  >,
  now: Date = new Date(),
): void {
  if (input.status === MilestoneStatus.ACTIVE && !input.startDate) {
    throw new DomainValidationError(
      "Start date is required when a milestone becomes active.",
      "startDate",
    );
  }
  if (input.status === MilestoneStatus.DONE) {
    if (!input.startDate) {
      throw new DomainValidationError(
        "Start date is required when a milestone is completed.",
        "startDate",
      );
    }
    if (!input.actualDate) {
      throw new DomainValidationError(
        "Actual completion date is required when a milestone is completed.",
        "actualDate",
      );
    }
    if (input.spend === undefined || input.spend === null) {
      throw new DomainValidationError(
        "Spend is required when a milestone is completed.",
        "spend",
      );
    }
  }
  if (
    input.startDate
    && input.actualDate
    && new Date(input.actualDate) < new Date(input.startDate)
  ) {
    throw new DomainValidationError(
      "Completion date cannot be before start date.",
      "actualDate",
    );
  }
  // A finished activity finished on a day that has happened. 11 Wheat Street's
  // "Certifier Inspection" was Done with an actual date of Tue 1 Dec 2026,
  // weeks ahead (#432), and every report built on it read it as complete.
  // A waived activity counts too: waiving the last open child completes the
  // parent with the child's date. Parsed through `toDate` so a malformed date
  // is a field error, not a RangeError from the formatter.
  const settledOn =
    input.status === MilestoneStatus.DONE
    || input.status === MilestoneStatus.NOT_REQUIRED
      ? toDate(input.actualDate || undefined, "actualDate")
      : undefined;
  if (settledOn && sydneyDateOnly(settledOn) > sydneyToday(now)) {
    throw new DomainValidationError(
      "A completed or waived activity's completion date cannot be in the future.",
      "actualDate",
    );
  }
}

function toDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainValidationError(`${field} is not a calendar date.`, field);
  }
  return date;
}

/**
 * What a site manager may change on an activity of a project they record on
 * but do not manage (`canRecordOnProject` without `canManageProject`): its
 * progress — starting it (with the day it started), finishing it, the day it
 * finished — and not its plan: re-dating the target or an existing start stays
 * with the office and the project's own site manager. (Waiving it is the
 * office's alone; see `updateMilestone`.) Dates are compared as Sydney
 * days, because the form sends back the stored ones it was opened with.
 */
function assertRecordingOnlyUpdate(
  input: { status: MilestoneStatus; targetDate?: string; startDate?: string },
  current: {
    status: MilestoneStatus;
    startDate: Date | null;
    targetDate: Date | null;
  },
  statusChanged: boolean,
): void {
  const sameDay = (
    sent: string | undefined,
    stored: Date | null,
    field: string,
  ) => {
    const date = toDate(sent, field);
    if (date === undefined) return true;
    return stored !== null && sydneyDateOnly(date) === sydneyDateOnly(stored);
  };
  if (!sameDay(input.targetDate, current.targetDate, "targetDate")) {
    throw new DomainAuthorizationError(
      "An activity's target date is changed by the office or the project's site manager.",
    );
  }
  // Recording when it started is progress: on the move to Active, on the move
  // out of Pending (finished without being started first), or the first time
  // a start is written at all.
  const recordsStart =
    (statusChanged
      && (input.status === MilestoneStatus.ACTIVE
        || current.status === MilestoneStatus.PENDING))
    || current.startDate === null;
  if (
    !recordsStart
    && !sameDay(input.startDate, current.startDate, "startDate")
  ) {
    throw new DomainAuthorizationError(
      "An activity's planned start is changed by the office or the project's site manager.",
    );
  }
}

/**
 * Update a milestone, and everything settling it means for its project.
 *
 * Must run inside the caller's transaction: the milestone row, the parent
 * roll-up, the project's spend and the project's status are one fact about
 * where the job is up to, and a partial application of them is a project whose
 * numbers do not add up.
 */
export async function updateMilestone(
  principal: DomainPrincipal,
  rawInput: UpdateMilestoneInput,
  db: DomainDb,
): Promise<UpdateMilestoneOutcome> {
  const { project: authorized } = await authorizeMilestoneRecording(
    principal,
    rawInput.milestoneId,
    db,
  );
  const projectId = authorized.id;

  const current = await db.milestone.findUniqueOrThrow({
    where: { id: rawInput.milestoneId },
    select: {
      id: true,
      name: true,
      parentId: true,
      projectId: true,
      status: true,
      spend: true,
      actualDate: true,
      startDate: true,
      targetDate: true,
      childrenMilestones: { select: { status: true } },
    },
  });
  const input = await withServerSideSpend(principal, rawInput, current, db);

  // Staying put is always allowed: an update that leaves the status alone is
  // editing something else — a target date most often — and the state machine
  // describes which *moves* are legal, not whether a milestone may be touched.
  const statusChanged = input.status !== current.status;
  if (
    statusChanged
    && !allowedMilestoneTransitions(
      current.status,
      current.childrenMilestones ?? [],
    ).includes(input.status)
  ) {
    throw new DomainTransitionError(
      `A milestone cannot go from ${current.status} to ${input.status}.`,
      current.status,
      input.status,
    );
  }

  assertMilestoneFieldsForStatus(input);
  // Waiving an activity cancels its open bookings and rejects their pending
  // approvals: booking work, so the office's (owner, 2026-11-20).
  if (
    statusChanged
    && input.status === MilestoneStatus.NOT_REQUIRED
    && !canBookTradies(principal)
  ) {
    throw new DomainAuthorizationError(
      "Marking an activity not required is for the office, because it cancels its tradie bookings.",
    );
  }
  if (!canManageProject(principal, authorized)) {
    assertRecordingOnlyUpdate(input, current, statusChanged);
  }

  const targetDate = toDate(input.targetDate, "targetDate");
  const startDate = toDate(input.startDate, "startDate");
  const actualDate = toDate(input.actualDate, "actualDate");
  // A waiver that sends no completion date does not keep a future one: the
  // date guard above only sees a date that was sent, and a waived activity
  // dated weeks ahead reads as finished in every report (#432).
  const clearsFutureCompletion =
    input.status === MilestoneStatus.NOT_REQUIRED
    && actualDate === undefined
    && current.actualDate != null
    && sydneyDateOnly(current.actualDate) > sydneyToday();

  // The first activity to start sets the project's start date to the day work
  // began, and the schedule is re-dated from it — the last time it can be: the
  // start date is locked from here on (`updateProject`). Counted before this
  // milestone is written, so it is not counting itself.
  const startsWork =
    statusChanged
    && input.status === MilestoneStatus.ACTIVE
    && startDate !== undefined
    && (await db.milestone.count({
      where: { projectId, status: { in: STARTED_MILESTONE_STATUSES } },
    })) === 0;

  const updated = await db.milestone.update({
    where: { id: input.milestoneId },
    data: {
      status: input.status,
      targetDate,
      startDate,
      actualDate: clearsFutureCompletion ? null : actualDate,
      spend:
        input.spend === undefined ? undefined : new Prisma.Decimal(input.spend),
    },
  });

  const settled =
    input.status === MilestoneStatus.DONE
    || input.status === MilestoneStatus.NOT_REQUIRED;

  let rolledUpParentId: string | null = null;
  let rolledUpParentStatus: MilestoneStatus | null = null;
  const parentUpdates: {
    id: string;
    status: MilestoneStatus;
    spend?: string;
    actualDate?: Date;
    startDate?: Date;
  }[] = [];

  let parentId = updated.parentId;
  while (parentId) {
    if (settled) {
      const [outstanding, siblings, waived, childrenSpend] = await Promise.all([
        db.milestone.count({
          where: {
            parentId,
            status: {
              notIn: [MilestoneStatus.DONE, MilestoneStatus.NOT_REQUIRED],
            },
          },
        }),
        db.milestone.count({ where: { parentId } }),
        db.milestone.count({
          where: {
            parentId,
            status: MilestoneStatus.NOT_REQUIRED,
          },
        }),
        db.milestone.aggregate({
          where: { parentId },
          _sum: { spend: true },
        }),
      ]);

      // Waiving every child leaves the parent's outcome to the operator.
      if (shouldCompleteParent(outstanding, siblings, waived)) {
        rolledUpParentStatus = MilestoneStatus.DONE;
        await db.milestone.update({
          where: { id: parentId },
          data: {
            status: rolledUpParentStatus,
            spend: childrenSpend._sum.spend ?? undefined,
            actualDate,
          },
        });
        rolledUpParentId ??= parentId;
        parentUpdates.push({
          id: parentId,
          status: MilestoneStatus.DONE,
          spend: childrenSpend._sum.spend?.toString(),
          actualDate,
        });
      } else {
        break;
      }
    } else if (input.status === MilestoneStatus.ACTIVE) {
      // Starting a child starts its parent, if it has not started already.
      const { count } = await db.milestone.updateMany({
        where: {
          id: parentId,
          status: { not: MilestoneStatus.ACTIVE },
        },
        data: { status: MilestoneStatus.ACTIVE, startDate },
      });
      if (count > 0) {
        parentUpdates.push({
          id: parentId,
          status: MilestoneStatus.ACTIVE,
          startDate,
        });
      }
    } else {
      break;
    }
    const parent = await db.milestone.findUnique({
      where: { id: parentId },
      select: { parentId: true },
    });
    parentId = parent?.parentId ?? null;
  }

  const [rootSpend, pendingCount] = await Promise.all([
    db.milestone.aggregate({
      where: { projectId, parentId: null },
      _sum: { spend: true },
    }),
    db.milestone.count({
      where: {
        projectId,
        status: { in: [MilestoneStatus.PENDING, MilestoneStatus.ACTIVE] },
      },
    }),
  ]);

  // What this milestone update means for the project's own status.
  //
  // The two ends are stated separately and neither infers the other. No
  // pending milestones means the build is finished. A milestone actually being
  // started means it has begun — the one event that ends the compliance stage
  // — and every other update leaves the status alone, because a spend
  // correction is not a statement about where the job is up to.
  const projectStatus =
    pendingCount === 0
      ? ProjectStatus.COMPLETED
      : input.status === MilestoneStatus.ACTIVE
        ? ProjectStatus.ACTIVE
        : null;

  let projectStartDate: Date | null = null;
  if (startsWork && startDate) {
    const { startDate: plannedStart } = await db.project.findUniqueOrThrow({
      select: { startDate: true },
      where: { id: projectId },
    });
    if (plannedStart.getTime() !== startDate.getTime()) {
      await rescheduleProjectFromStart(
        principal,
        { previousStartDate: plannedStart, projectId, startDate },
        db,
      );
      projectStartDate = startDate;
    }
  }

  const project = await db.project.update({
    where: { id: projectId },
    data: {
      spent: rootSpend._sum.spend ?? undefined,
      ...(projectStatus ? { status: projectStatus } : {}),
      ...(projectStartDate ? { startDate: projectStartDate } : {}),
    },
    select: { siteManagerId: true, spent: true },
  });

  // Closing an activity is what plans the next one: it starts the day this one
  // was completed, and is due that day plus its own duration. That holds on
  // the close itself and when a completed activity's completion date is
  // corrected -- the plan hangs off that date. Any other edit to a completed
  // activity (its spend, say) re-sends the stored date and moves nothing.
  const completionMoved =
    input.status === MilestoneStatus.DONE
    && actualDate !== undefined
    && (statusChanged
      || current.actualDate?.getTime() !== actualDate.getTime());
  const replannedActivities =
    completionMoved && actualDate
      ? await replanAfterActivity(
          { from: actualDate, milestoneId: updated.id, projectId },
          db,
        )
      : [];

  const stageClaim = settled
    ? await resolveDueStageClaim({ milestoneId: updated.id, projectId }, db)
    : null;

  // A settled milestone takes its open bookings with it — and so does a parent
  // this update rolled up — or they stay "confirmed" and alerting for ever.
  const settledBookings: { completed: string[]; cancelled: string[] } = {
    cancelled: [],
    completed: [],
  };
  const settledMilestones: [string, MilestoneStatus][] = settled
    ? [[updated.id, input.status]]
    : [];
  for (const parent of parentUpdates) {
    if (parent.status === MilestoneStatus.DONE)
      settledMilestones.push([parent.id, parent.status]);
  }
  for (const [milestoneId, status] of settledMilestones) {
    const result = await settleMilestoneBookings(
      {
        milestoneId,
        principal,
        settlement: status === MilestoneStatus.DONE ? "DONE" : "NOT_REQUIRED",
      },
      db,
    );
    settledBookings.completed.push(...result.completed);
    settledBookings.cancelled.push(...result.cancelled);
  }

  // The figures go back the way the project page hands them out: a caller who
  // may not see the money gets none here either, from any adapter. Whether a
  // progress claim is now due is not a figure, and stays.
  const seesMoney = canSeeProjectFinancials(principal);
  const milestone = {
    ...updated,
    budget: updated.budget.toString(),
    previousStatus: current.status,
    spend: updated.spend?.toString(),
  };
  return {
    parentUpdates: seesMoney
      ? parentUpdates
      : parentUpdates.map((parent) => ({ ...parent, spend: undefined })),
    milestone: seesMoney ? milestone : hideMilestoneFinancials(milestone),
    projectSpent: seesMoney ? project.spent.toString() : HIDDEN_AMOUNT,
    projectStartDate,
    projectStatus,
    replannedActivities,
    rolledUpParentId,
    settledBookings,
    siteManagerId: project.siteManagerId,
    stageClaim,
    statusChanged,
  };
}

export type AttachedMilestonePhotos = {
  readonly milestoneId: string;
  readonly projectId: string;
  readonly milestoneName: string;
  readonly fileIds: readonly string[];
  readonly siteManagerId: string | null;
};

/**
 * Attach already-uploaded files to a milestone.
 *
 * **An authorization gap closed.** `lib/data/milestones.ts#addPhotosToMilestone`
 * connected whatever file ids it was handed to whatever milestone id it was
 * handed, and its route checked neither. Two things are asserted now: the
 * caller may manage the milestone's project, and every file already belongs to
 * that project — so an upload cannot pull another project's (or a lead's)
 * document onto a milestone, which is the same defect
 * `lib/domain/tradies/incidents.ts` fixed for incidents.
 */
export async function attachMilestonePhotos(
  principal: DomainPrincipal,
  input: { milestoneId: string; fileIds: readonly string[] },
  db: DomainDb,
): Promise<AttachedMilestonePhotos> {
  const {
    project: { id: projectId, siteManagerId },
  } = await authorizeMilestoneRecording(principal, input.milestoneId, db);

  const fileIds = [...new Set(input.fileIds.map((id) => id.trim()))].filter(
    Boolean,
  );
  if (fileIds.length === 0) {
    throw new DomainValidationError(
      "At least one file must be attached.",
      "fileIds",
    );
  }

  const files = await db.file.findMany({
    where: { id: { in: fileIds }, projectId },
    select: { id: true },
  });
  if (files.length !== fileIds.length) {
    throw new DomainNotFoundError(
      "One or more of those files does not belong to this project.",
    );
  }

  const milestone = await db.milestone.update({
    where: { id: input.milestoneId },
    data: { files: { connect: fileIds.map((id) => ({ id })) } },
    select: { id: true, name: true },
  });

  return {
    fileIds,
    milestoneId: milestone.id,
    milestoneName: milestone.name,
    projectId,
    siteManagerId,
  };
}

/**
 * Re-plan the open activities after one activity, from a given day.
 *
 * Not a command: `updateMilestone` calls it when an activity closes, and the
 * build-sequence save calls it when a duration changes, each inside the
 * transaction that made the change. The rule itself is the pure
 * `replanFollowingActivities`; this reads the sequence and writes what moved.
 */
export async function replanAfterActivity(
  input: {
    readonly projectId: string;
    readonly milestoneId: string;
    readonly from: Date;
  },
  db: DomainDb,
): Promise<{ id: string; targetDate: Date }[]> {
  const ordered = await db.milestone.findMany({
    orderBy: { order: "asc" },
    select: {
      actualDate: true,
      estimatedDays: true,
      id: true,
      startDate: true,
      status: true,
      targetDate: true,
    },
    where: { projectId: input.projectId },
  });
  const index = ordered.findIndex((row) => row.id === input.milestoneId);
  if (index === -1) return [];

  const changes = replanFollowingActivities(ordered, index, input.from);
  for (const change of changes) {
    // Conditional on PENDING, so an activity started between the read and
    // this write -- a second tab -- keeps the plan it was started against.
    await db.milestone.updateMany({
      data: { targetDate: change.targetDate },
      where: { id: change.id, status: MilestoneStatus.PENDING },
    });
  }
  return changes;
}

/**
 * Re-plan every open project activity that follows a build-sequence row whose
 * duration just changed.
 *
 * The changed activity's own deadline moves by itself -- it is its start plus
 * its duration -- but each PENDING activity after it was planned from that
 * deadline, so the rest of the sequence is re-planned from the activity's new
 * estimated end. Completed activities are never touched.
 */
export async function replanAfterDurationChange(
  input: { readonly milestoneIds: readonly string[] },
  db: DomainDb,
): Promise<number> {
  if (input.milestoneIds.length === 0) return 0;
  const changed = await db.milestone.findMany({
    orderBy: { order: "asc" },
    select: {
      estimatedDays: true,
      id: true,
      projectId: true,
      startDate: true,
      targetDate: true,
    },
    where: { id: { in: [...input.milestoneIds] } },
  });

  // The earliest changed activity on each project: re-planning from it covers
  // every later one, whose own new duration the walk reads as it passes.
  const earliestByProject = new Map<string, (typeof changed)[number]>();
  for (const row of changed) {
    if (!earliestByProject.has(row.projectId)) {
      earliestByProject.set(row.projectId, row);
    }
  }

  let moved = 0;
  for (const row of earliestByProject.values()) {
    const changes = await replanAfterActivity(
      {
        from: milestoneEndDate(row),
        milestoneId: row.id,
        projectId: row.projectId,
      },
      db,
    );
    moved += changes.length;
  }
  return moved;
}

/**
 * Re-date every activity on a project from a new start date.
 *
 * Every activity moves, whatever its status, so the whole schedule stays one
 * sequence; a hand-set target date is overwritten. Not a command on its own:
 * `updateProject` authorizes, decides the start date really moved, and runs
 * this inside the transaction that writes it, so the project never shows a new
 * start against the old schedule.
 */
export async function rescheduleMilestonesFromStart(
  input: { readonly projectId: string; readonly startDate: Date },
  db: DomainDb,
): Promise<{ rescheduled: number }> {
  const milestones = await db.milestone.findMany({
    orderBy: { order: "asc" },
    select: { id: true, estimatedDays: true },
    where: { projectId: input.projectId },
  });

  const targets = milestoneTargetDates(input.startDate, milestones);
  for (const [position, milestone] of milestones.entries()) {
    await db.milestone.update({
      data: { targetDate: targets[position] },
      where: { id: milestone.id },
    });
  }

  return { rescheduled: milestones.length };
}

/**
 * Move a project's schedule onto a new start date, and put the move on record.
 *
 * Re-dates every activity (`rescheduleMilestonesFromStart`) and writes the
 * history entry. The caller writes `Project.startDate` itself, in the same
 * transaction: `updateProject` when an operator moves it before work starts,
 * `updateMilestone` when the first activity starting sets it.
 */
export async function rescheduleProjectFromStart(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly previousStartDate: Date;
    readonly startDate: Date;
  },
  db: DomainDb,
): Promise<number> {
  const { rescheduled } = await rescheduleMilestonesFromStart(
    { projectId: input.projectId, startDate: input.startDate },
    db,
  );
  await logActionOrThrow(
    {
      ...createActivityLogEntry("projectStartDateChanged", {
        milestonesRescheduled: rescheduled,
        previousStartDate: input.previousStartDate.toISOString().slice(0, 10),
        projectId: input.projectId,
        startDate: input.startDate.toISOString().slice(0, 10),
      }),
      authorId: attributionUserId(principal),
    },
    db,
  );
  return rescheduled;
}

/**
 * Seed a new project's milestones from the configured template.
 *
 * Budgets come from the offer's cost lines: a line referenced by several
 * template activities is split evenly between them, and a parent's budget is
 * the sum of its children's. Target dates follow `milestoneTargetDates` using
 * the durations snapshotted from the database template.
 *
 * Runs inside the creating transaction, so the project never exists without
 * its milestones.
 */
export async function createMilestonesFromTemplate(
  input: {
    projectId: string;
    startDate: Date;
    costLines?: readonly OfferWorkspaceCostLine[];
  },
  db: DomainDb,
): Promise<{ created: number }> {
  const milestoneTemplates = await db.milestoneTemplate.findMany({
    orderBy: { order: "asc" },
    include: { requiredTradeTypes: { select: { id: true } } },
  });
  if (!milestoneTemplates.length)
    throw new DomainValidationError(
      "The build sequence is empty. Add activities under Admin before creating a project.",
    );
  const referenceCounts = milestoneTemplates.reduce((map, template) => {
    template.relatedCostLines?.forEach((costLineName) => {
      map.set(costLineName, (map.get(costLineName) ?? 0) + 1);
    });
    return map;
  }, new Map<string, number>());

  const budgetFor = (
    relatedCostLines: readonly string[] | undefined,
  ): number => {
    if (!relatedCostLines?.length || !input.costLines) return 0;
    return input.costLines
      .filter((costLine) => relatedCostLines.includes(costLine.itemName))
      .reduce((total, costLine) => {
        const shared = referenceCounts.get(costLine.itemName) ?? 1;
        return total + costLine.costExGst / shared;
      }, 0);
  };

  const inOrder = [...milestoneTemplates].sort((a, b) => a.order - b.order);
  const targets = milestoneTargetDates(input.startDate, inOrder);
  const records = inOrder.map((template, position) => ({
    ...template,
    id: randomUUID(),
    templateId: template.id,
    targetDate: targets[position],
    totalBudget: budgetFor(template.relatedCostLines),
  }));

  const idByTemplate = new Map(
    records.map((record) => [record.templateId, record.id]),
  );

  // Roll each child's budget up into its parent.
  for (const record of [...records].reverse()) {
    if (record.parentId === null || record.parentId === undefined) continue;
    const parent = records.find(
      (candidate) => candidate.id === idByTemplate.get(record.parentId!),
    );
    if (parent) parent.totalBudget += record.totalBudget;
  }

  const created = await db.milestone.createMany({
    data: records.map((record) => ({
      id: record.id,
      projectId: input.projectId,
      name: record.name,
      order: record.order,
      targetDate: record.targetDate,
      estimatedDays: record.estimatedDays,
      templateId: record.templateId,
      parentId:
        record.parentId === null || record.parentId === undefined
          ? null
          : (idByTemplate.get(record.parentId) ?? null),
      projectStage: record.projectStage,
      budget: new Prisma.Decimal(record.totalBudget),
    })),
  });
  // createMany cannot write a relation; the trades follow, in the same transaction.
  for (const record of records) {
    if (!record.requiredTradeTypes.length) continue;
    await db.milestone.update({
      where: { id: record.id },
      data: { requiredTradeTypes: { connect: record.requiredTradeTypes } },
    });
  }

  return { created: created.count };
}

/** The milestone rows the project screens list, ordered as they render. */
export async function listProjectMilestones(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  await authorizeProjectRecording(principal, projectId, db);
  return db.milestone.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isPhotoRequired: true,
      status: true,
      order: true,
    },
  });
}
