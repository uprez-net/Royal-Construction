import {
  MilestoneStatus,
  Prisma,
  ProjectStage,
  ProjectStatus,
  type Milestone,
} from "@prisma/client";
import { v4 as randomUUID } from "uuid";

import { milestoneTemplates } from "@/constants/milestoneTemplate";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";

import { authorizeMilestone, authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
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
  milestoneTargetDate,
  STARTED_MILESTONE_STATUSES,
} from "./milestone-schedule";
import { settleMilestoneBookings } from "../tradies/settlement";

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

const MILESTONE_STATE_MACHINE: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: [MilestoneStatus.ACTIVE, MilestoneStatus.NOT_REQUIRED],
  ACTIVE: [MilestoneStatus.DONE],
  DONE: [MilestoneStatus.DONE],
  NOT_REQUIRED: [MilestoneStatus.PENDING],
};

/** The transitions this milestone may take from where it is now. */
export function allowedMilestoneTransitions(
  from: MilestoneStatus,
): readonly MilestoneStatus[] {
  return MILESTONE_STATE_MACHINE[from] ?? [];
}

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
   * Bookings this update settled: completed or cancelled because the milestone
   * they were for (or the parent it rolled up) was settled. Empty otherwise.
   */
  readonly settledBookings: {
    readonly completed: readonly string[];
    readonly cancelled: readonly string[];
  };
};

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
 * Update a milestone, and everything settling it means for its project.
 *
 * Must run inside the caller's transaction: the milestone row, the parent
 * roll-up, the project's spend and the project's status are one fact about
 * where the job is up to, and a partial application of them is a project whose
 * numbers do not add up.
 */
export async function updateMilestone(
  principal: DomainPrincipal,
  input: UpdateMilestoneInput,
  db: DomainDb,
): Promise<UpdateMilestoneOutcome> {
  const {
    project: { id: projectId },
  } = await authorizeMilestone(principal, input.milestoneId, db);

  const current = await db.milestone.findUniqueOrThrow({
    where: { id: input.milestoneId },
    select: {
      id: true,
      name: true,
      parentId: true,
      projectId: true,
      status: true,
    },
  });

  // Staying put is always allowed: an update that leaves the status alone is
  // editing something else — a target date most often — and the state machine
  // describes which *moves* are legal, not whether a milestone may be touched.
  const statusChanged = input.status !== current.status;
  if (
    statusChanged
    && !MILESTONE_STATE_MACHINE[current.status].includes(input.status)
  ) {
    throw new DomainTransitionError(
      `A milestone cannot go from ${current.status} to ${input.status}.`,
      current.status,
      input.status,
    );
  }

  assertMilestoneFieldsForStatus(input);

  const targetDate = toDate(input.targetDate, "targetDate");
  const startDate = toDate(input.startDate, "startDate");
  const actualDate = toDate(input.actualDate, "actualDate");

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
      actualDate,
      spend:
        input.spend === undefined ? undefined : new Prisma.Decimal(input.spend),
    },
  });

  const settled =
    input.status === MilestoneStatus.DONE
    || input.status === MilestoneStatus.NOT_REQUIRED;

  let rolledUpParentId: string | null = null;
  let rolledUpParentStatus: MilestoneStatus | null = null;

  if (updated.parentId) {
    if (settled) {
      const [outstanding, siblings, waived, childrenSpend] = await Promise.all([
        db.milestone.count({
          where: {
            parentId: updated.parentId,
            status: {
              notIn: [MilestoneStatus.DONE, MilestoneStatus.NOT_REQUIRED],
            },
          },
        }),
        db.milestone.count({ where: { parentId: updated.parentId } }),
        db.milestone.count({
          where: {
            parentId: updated.parentId,
            status: MilestoneStatus.NOT_REQUIRED,
          },
        }),
        db.milestone.aggregate({
          where: { parentId: updated.parentId },
          _sum: { spend: true },
        }),
      ]);

      if (outstanding === 0) {
        rolledUpParentStatus =
          waived === siblings
            ? MilestoneStatus.NOT_REQUIRED
            : MilestoneStatus.DONE;
        await db.milestone.update({
          where: { id: updated.parentId },
          data: {
            status: rolledUpParentStatus,
            spend: childrenSpend._sum.spend ?? undefined,
            actualDate,
          },
        });
        rolledUpParentId = updated.parentId;
      }
    } else if (input.status === MilestoneStatus.ACTIVE) {
      // Starting a child starts its parent, if it has not started already.
      await db.milestone.updateMany({
        where: {
          id: updated.parentId,
          status: { not: MilestoneStatus.ACTIVE },
        },
        data: { status: MilestoneStatus.ACTIVE, startDate },
      });
    }
  }

  const [rootSpend, pendingCount] = await Promise.all([
    db.milestone.aggregate({
      where: { projectId, parentId: null },
      _sum: { spend: true },
    }),
    db.milestone.count({
      where: { projectId, status: MilestoneStatus.PENDING },
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
  if (rolledUpParentId && rolledUpParentStatus) {
    settledMilestones.push([rolledUpParentId, rolledUpParentStatus]);
  }
  for (const [milestoneId, status] of settledMilestones) {
    const result = await settleMilestoneBookings(
      {
        milestoneId,
        settlement: status === MilestoneStatus.DONE ? "DONE" : "NOT_REQUIRED",
      },
      db,
    );
    settledBookings.completed.push(...result.completed);
    settledBookings.cancelled.push(...result.cancelled);
  }

  return {
    milestone: {
      ...updated,
      budget: updated.budget.toString(),
      previousStatus: current.status,
      spend: updated.spend?.toString(),
    },
    projectSpent: project.spent.toString(),
    projectStartDate,
    projectStatus,
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
  } = await authorizeMilestone(principal, input.milestoneId, db);

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
    select: { id: true },
    where: { projectId: input.projectId },
  });

  for (const [position, milestone] of milestones.entries()) {
    await db.milestone.update({
      data: { targetDate: milestoneTargetDate(input.startDate, position) },
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
 * the sum of its children's. Target dates follow `milestoneTargetDate`.
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
  const records = inOrder.map((template, position) => ({
    ...template,
    id: randomUUID(),
    targetDate: milestoneTargetDate(input.startDate, position),
    totalBudget: budgetFor(template.relatedCostLines),
  }));

  const idByOrder = new Map(records.map((record) => [record.order, record.id]));

  // Roll each child's budget up into its parent.
  for (const record of records) {
    if (record.parentId === null || record.parentId === undefined) continue;
    const parent = records.find(
      (candidate) => candidate.id === idByOrder.get(record.parentId!),
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
      parentId:
        record.parentId === null || record.parentId === undefined
          ? null
          : (idByOrder.get(record.parentId) ?? null),
      projectStage: record.projectStage,
      budget: new Prisma.Decimal(record.totalBudget),
    })),
  });

  return { created: created.count };
}

/** The milestone rows the project screens list, ordered as they render. */
export async function listProjectMilestones(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  await authorizeProject(principal, projectId, db);
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
