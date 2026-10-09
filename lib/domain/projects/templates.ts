import { createHash, randomUUID } from "node:crypto";
import { Prisma, ProjectStage } from "@prisma/client";
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
          requiredTradeTypeId: row.requiredTradeTypeId,
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
  });
  return {
    revision: templateRevision(rows),
    activities: rows.map(
      ({
        id,
        name,
        order,
        parentId,
        projectStage,
        relatedCostLines,
        estimatedDays,
        requiredTradeTypeId,
      }) => ({
        id,
        name,
        order,
        parentId,
        projectStage,
        relatedCostLines,
        estimatedDays,
        requiredTradeTypeId,
      }),
    ),
  };
}

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
        if (
          row.requiredTradeTypeId
          && !available.has(row.requiredTradeTypeId)
          && row.requiredTradeTypeId !== previous?.requiredTradeTypeId
        )
          throw new DomainValidationError(
            "Choose an active tradie category from the list.",
            "requiredTradeTypeId",
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
        const data = {
          ...row,
          name: row.name.trim(),
          relatedCostLines: row.relatedCostLines
            .map((line) => line.trim())
            .filter(Boolean),
        };
        const previous = currentById.get(row.id);
        if (
          previous
          && templateRevision([previous]) === templateRevision([data])
        ) {
          await tx.milestoneTemplate.update({
            where: { id: row.id },
            data: { order: row.order, parentId: row.parentId },
          });
          continue;
        }
        await tx.milestoneTemplate.upsert({
          where: { id: row.id },
          create: data,
          update: data,
        });
      }
      return readMilestoneTemplate(principal, tx);
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
