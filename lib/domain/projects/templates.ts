import { createHash, randomUUID } from "node:crypto";
import { MilestoneStatus, Prisma, ProjectStage } from "@prisma/client";
import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainValidationError,
} from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import type {
  MilestoneTemplateSnapshot,
  TemplateActivity,
  MilestoneTemplateEdit,
} from "@/types/milestone-template";
import { coerceCostSchedule } from "../admin/offer-content-coerce";
import { moveTemplateActivity, templateDescendants } from "./template-tree";
import { replanAfterDurationChange } from "./milestones";

export async function listTemplateCostTasks(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<string[]> {
  requireAdminPrincipal(principal);
  const content = await db.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { costSchedule: true },
  });
  return [
    ...new Set(
      coerceCostSchedule(content?.costSchedule)
        .rows.map((row) => row.task.trim())
        .filter(Boolean),
    ),
  ];
}

export function templateRevision(rows: readonly TemplateActivity[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          order: row.order,
          parentId: row.parentId,
          projectStage: row.projectStage,
          relatedCostLines: row.relatedCostLines,
          estimatedDays: row.estimatedDays,
          requiredTradeTypeIds: [...row.requiredTradeTypeIds].sort(),
        })),
      ),
    )
    .digest("hex");
}

export function validateTemplate(
  activities: readonly TemplateActivity[],
): void {
  if (!activities.length)
    throw new DomainValidationError(
      "Keep at least one activity in the build sequence.",
    );
  if (activities.length > 500)
    throw new DomainValidationError(
      "Keep the build sequence to 500 activities or fewer.",
    );
  const byId = new Map(activities.map((row) => [row.id, row]));
  if (byId.size !== activities.length)
    throw new DomainValidationError("Each activity needs a unique ID.");
  const orders = new Set<number>();
  for (const row of activities) {
    if (!row.id.trim() || !row.name.trim() || row.name.trim().length > 200)
      throw new DomainValidationError(
        "Give every activity a name of up to 200 characters.",
      );
    if (
      !Number.isInteger(row.estimatedDays)
      || row.estimatedDays < 1
      || row.estimatedDays > 365
    )
      throw new DomainValidationError(
        "Estimated days must be a whole number between 1 and 365.",
        "estimatedDays",
      );
    if (!Object.values(ProjectStage).includes(row.projectStage))
      throw new DomainValidationError(
        "Choose a contract stage for every activity.",
      );
    if (!Number.isInteger(row.order) || row.order < 1 || orders.has(row.order))
      throw new DomainValidationError(
        "Each activity needs a unique positive sequence position.",
      );
    orders.add(row.order);
    const visited = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId) {
      if (visited.has(parentId))
        throw new DomainValidationError(
          "An activity cannot be linked beneath itself or one of its sub-activities.",
        );
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent)
        throw new DomainValidationError(
          "The selected parent activity no longer exists.",
        );
      if (parent.order >= row.order)
        throw new DomainValidationError(
          "Place parent activities before their sub-activities.",
        );
      parentId = parent.parentId;
    }
  }
}

export async function readMilestoneTemplate(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<MilestoneTemplateSnapshot> {
  requireAdminPrincipal(principal);
  const rows = await db.milestoneTemplate.findMany({
    orderBy: { order: "asc" },
    include: { requiredTradeTypes: { select: { id: true } } },
  });
  const activities = rows.map(
    ({
      id,
      name,
      order,
      parentId,
      projectStage,
      relatedCostLines,
      estimatedDays,
      requiredTradeTypes,
    }) => ({
      id,
      name,
      order,
      parentId,
      projectStage,
      relatedCostLines,
      estimatedDays,
      requiredTradeTypeIds: requiredTradeTypes.map((trade) => trade.id).sort(),
    }),
  );
  return { revision: templateRevision(activities), activities };
}

/**
 * Carry a changed duration onto the project activities still open against it.
 *
 * Issue #422: the build sequence is where an activity's duration is managed,
 * so changing it there re-plans the work not yet finished. PENDING and ACTIVE
 * activities take the new duration; a DONE activity keeps the one it was
 * planned with, because its estimated end is part of its history ("finished
 * 2 days late" has to stay true). NOT_REQUIRED takes no time either way.
 *
 * Returns the projects whose activities changed, so the adapter can refresh
 * their screens once the transaction commits.
 */
async function applyDurationChanges(
  tx: DomainDb,
  rows: readonly TemplateActivity[],
  previousById: ReadonlyMap<string, TemplateActivity>,
): Promise<string[]> {
  const durationById = new Map<string, number>();
  for (const row of rows) {
    const previous = previousById.get(row.id);
    if (previous && previous.estimatedDays !== row.estimatedDays) {
      durationById.set(row.id, row.estimatedDays);
    }
  }
  if (durationById.size === 0) return [];

  // One read for every changed row, grouped here rather than a read per row.
  const open = await tx.milestone.findMany({
    select: { id: true, projectId: true, templateId: true },
    where: {
      status: { in: [MilestoneStatus.PENDING, MilestoneStatus.ACTIVE] },
      templateId: { in: [...durationById.keys()] },
    },
  });
  if (open.length === 0) return [];

  const idsByTemplate = new Map<string, string[]>();
  for (const milestone of open) {
    if (!milestone.templateId) continue;
    const ids = idsByTemplate.get(milestone.templateId) ?? [];
    ids.push(milestone.id);
    idsByTemplate.set(milestone.templateId, ids);
  }
  for (const [templateId, ids] of idsByTemplate) {
    await tx.milestone.updateMany({
      data: { estimatedDays: durationById.get(templateId) },
      where: { id: { in: ids } },
    });
  }
  await replanAfterDurationChange(
    { milestoneIds: open.map((milestone) => milestone.id) },
    tx,
  );
  return [...new Set(open.map((milestone) => milestone.projectId))];
}

export type SavedMilestoneTemplate = {
  readonly template: MilestoneTemplateSnapshot;
  /** Projects whose open activities took a changed duration. */
  readonly affectedProjectIds: readonly string[];
};

/**
 * Whole-template save: a stale tab cannot overwrite a later edit. Opens a
 * serializable transaction, or joins the caller's serializable transaction
 * so Eve can commit the template and its audit result together.
 */
export async function saveMilestoneTemplate(
  principal: DomainPrincipal,
  input: MilestoneTemplateSnapshot,
  db: DomainDb,
): Promise<MilestoneTemplateSnapshot> {
  const { template } = await saveMilestoneTemplateWithEffects(
    principal,
    input,
    db,
  );
  return template;
}

/**
 * The same save, also reporting which projects it changed. The App's save
 * route uses it to refresh those projects' cached screens after the commit;
 * cache work is the adapter's, so it is reported rather than done here.
 */
export async function saveMilestoneTemplateWithEffects(
  principal: DomainPrincipal,
  input: MilestoneTemplateSnapshot,
  db: DomainDb,
): Promise<SavedMilestoneTemplate> {
  requireAdminPrincipal(principal);
  validateTemplate(input.activities);
  const inOrder = [...input.activities].sort((a, b) => a.order - b.order);
  try {
    const write = async (tx: DomainDb) => {
      const current = await readMilestoneTemplate(principal, tx);
      if (current.revision !== input.revision)
        throw new DomainStaleVersionError(
          "The build sequence changed in another tab. Reload it before saving.",
        );
      const currentById = new Map(
        current.activities.map((row) => [row.id, row]),
      );
      const trades = await tx.tradeType.findMany({
        select: { id: true, archivedAt: true },
      });
      const available = new Set(
        trades.filter((trade) => !trade.archivedAt).map((trade) => trade.id),
      );
      const tasks = new Set(await listTemplateCostTasks(principal, tx));
      for (const row of inOrder) {
        const previous = currentById.get(row.id);
        if (
          row.relatedCostLines.some(
            (line) =>
              !tasks.has(line.trim())
              && !previous?.relatedCostLines.includes(line.trim()),
          )
        ) {
          throw new DomainValidationError(
            "Choose related cost lines from the task names in Admin Offer Content → Cost Schedule.",
            "relatedCostLines",
          );
        }
        // An archived trade the activity already needed may stay; it cannot be added.
        if (
          row.requiredTradeTypeIds.some(
            (tradeId) =>
              !available.has(tradeId)
              && !previous?.requiredTradeTypeIds.includes(tradeId),
          )
        )
          throw new DomainValidationError(
            "Choose active tradie categories from the list.",
            "requiredTradeTypeIds",
          );
      }
      // Release unique positions and parent links before replacing the hierarchy.
      // Negative positions are temporary and never visible outside this transaction.
      if (current.activities.length) {
        await tx.milestoneTemplate.updateMany({ data: { parentId: null } });
        await tx.$executeRaw`UPDATE "MilestoneTemplate" SET "order" = -"order"`;
      }
      const kept = inOrder.map((row) => row.id);
      await tx.milestoneTemplate.deleteMany({
        where: { id: { notIn: kept } },
      });
      for (const row of inOrder) {
        const { requiredTradeTypeIds, ...fields } = row;
        const data = {
          ...fields,
          name: row.name.trim(),
          relatedCostLines: row.relatedCostLines
            .map((line) => line.trim())
            .filter(Boolean),
        };
        const previous = currentById.get(row.id);
        if (
          previous
          && templateRevision([previous])
            === templateRevision([{ ...data, requiredTradeTypeIds }])
        ) {
          await tx.milestoneTemplate.update({
            where: { id: row.id },
            data: { order: row.order, parentId: row.parentId },
          });
          continue;
        }
        const trades = requiredTradeTypeIds.map((id) => ({ id }));
        await tx.milestoneTemplate.upsert({
          where: { id: row.id },
          create: { ...data, requiredTradeTypes: { connect: trades } },
          update: { ...data, requiredTradeTypes: { set: trades } },
        });
      }
      const affectedProjectIds = await applyDurationChanges(
        tx,
        inOrder,
        currentById,
      );
      return {
        affectedProjectIds,
        template: await readMilestoneTemplate(principal, tx),
      };
    };
    return "$transaction" in db
      ? await db.$transaction(write, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        })
      : await write(db);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2034"
    )
      throw new DomainStaleVersionError(
        "The build sequence changed while saving. Reload it and try again.",
      );
    throw error;
  }
}

/** Targeted edits, saved through the same revision and dependency rules as the screen. */
export async function editMilestoneTemplate(
  principal: DomainPrincipal,
  input: MilestoneTemplateEdit,
  db: DomainDb,
): Promise<MilestoneTemplateSnapshot> {
  const current = await readMilestoneTemplate(principal, db);
  if (current.revision !== input.revision)
    throw new DomainStaleVersionError(
      "The build sequence changed since it was reviewed. Read it again before applying these changes.",
    );
  let activities = current.activities.map((row) => ({
    ...row,
    relatedCostLines: [...row.relatedCostLines],
  }));
  for (const change of input.changes) {
    if (change.type === "add") {
      const row: TemplateActivity = {
        ...change.activity,
        id: change.activity.id ?? randomUUID(),
        order: Math.max(0, ...activities.map((activity) => activity.order)) + 1,
      };
      if (activities.some((activity) => activity.id === row.id))
        throw new DomainValidationError("A new activity must have a new ID.");
      activities.push({ ...row, parentId: null });
      if (row.parentId)
        activities = moveTemplateActivity(
          activities,
          row.id,
          row.parentId,
          "child",
        );
      continue;
    }
    const activity = activities.find((row) => row.id === change.activityId);
    if (!activity)
      throw new DomainNotFoundError(
        "That build sequence activity no longer exists.",
      );
    if (change.type === "update") {
      activities = activities.map((row) =>
        row.id === change.activityId ? { ...row, ...change.patch } : row,
      );
    } else if (change.type === "move") {
      activities = moveTemplateActivity(
        activities,
        change.activityId,
        change.targetId,
        change.mode,
      );
    } else {
      if (templateDescendants(activities, change.activityId).size > 1)
        throw new DomainValidationError(
          "Move the sub-activities elsewhere before removing this activity.",
        );
      activities = activities.filter((row) => row.id !== change.activityId);
    }
    activities = activities.map((row, index) => ({ ...row, order: index + 1 }));
  }
  return saveMilestoneTemplate(
    principal,
    { revision: input.revision, activities },
    db,
  );
}
