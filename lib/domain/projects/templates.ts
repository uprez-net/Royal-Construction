import { createHash } from "node:crypto";
import { Prisma, ProjectStage } from "@prisma/client";
import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainStaleVersionError, DomainValidationError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import type { MilestoneTemplateSnapshot, TemplateActivity } from "@/types/milestone-template";

export function templateRevision(rows: readonly TemplateActivity[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => ({
    id: row.id, name: row.name, order: row.order, parentId: row.parentId,
    projectStage: row.projectStage, relatedCostLines: row.relatedCostLines,
    estimatedDays: row.estimatedDays, requiredTradeTypeId: row.requiredTradeTypeId,
  })))).digest("hex");
}

export function validateTemplate(activities: readonly TemplateActivity[]): void {
  if (!activities.length) throw new DomainValidationError("Keep at least one activity in the build sequence.");
  const byId = new Map(activities.map((row) => [row.id, row]));
  if (byId.size !== activities.length) throw new DomainValidationError("Each activity needs a unique ID.");
  const orders = new Set<number>();
  for (const row of activities) {
    if (!row.id.trim() || !row.name.trim() || row.name.trim().length > 200) throw new DomainValidationError("Give every activity a name of up to 200 characters.");
    if (!Number.isInteger(row.estimatedDays) || row.estimatedDays < 1 || row.estimatedDays > 365) throw new DomainValidationError("Estimated days must be a whole number between 1 and 365.", "estimatedDays");
    if (!Object.values(ProjectStage).includes(row.projectStage)) throw new DomainValidationError("Choose a contract stage for every activity.");
    if (!Number.isInteger(row.order) || row.order < 1 || orders.has(row.order)) throw new DomainValidationError("Each activity needs a unique positive sequence position.");
    orders.add(row.order);
    const visited = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new DomainValidationError("An activity cannot be linked beneath itself or one of its sub-activities.");
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new DomainValidationError("The selected parent activity no longer exists.");
      if (parent.order >= row.order) throw new DomainValidationError("Place parent activities before their sub-activities.");
      parentId = parent.parentId;
    }
  }
}

export async function readMilestoneTemplate(principal: DomainPrincipal, db: DomainDb): Promise<MilestoneTemplateSnapshot> {
  requireAdminPrincipal(principal);
  const rows = await db.milestoneTemplate.findMany({ orderBy: { order: "asc" } });
  return { revision: templateRevision(rows), activities: rows.map(({ id, name, order, parentId, projectStage, relatedCostLines, estimatedDays, requiredTradeTypeId }) => ({ id, name, order, parentId, projectStage, relatedCostLines, estimatedDays, requiredTradeTypeId })) };
}

/** Whole-template save: a stale tab cannot overwrite a later edit, and hierarchy writes are atomic. */
export async function saveMilestoneTemplate(principal: DomainPrincipal, input: MilestoneTemplateSnapshot, db: TransactionalDomainDb): Promise<MilestoneTemplateSnapshot> {
  requireAdminPrincipal(principal);
  validateTemplate(input.activities);
  const inOrder = [...input.activities].sort((a, b) => a.order - b.order);
  try {
    return await db.$transaction(async (tx) => {
      const current = await readMilestoneTemplate(principal, tx);
      if (current.revision !== input.revision) throw new DomainStaleVersionError("The build sequence changed in another tab. Reload it before saving.");
      const trades = await tx.tradeType.findMany({ select: { id: true, archivedAt: true } });
      const available = new Set(trades.filter((trade) => !trade.archivedAt).map((trade) => trade.id));
      for (const row of inOrder) {
        const previous = current.activities.find((old) => old.id === row.id);
        if (row.requiredTradeTypeId && !available.has(row.requiredTradeTypeId)
          && row.requiredTradeTypeId !== previous?.requiredTradeTypeId) throw new DomainValidationError("Choose an active tradie category from the list.", "requiredTradeTypeId");
      }
      // Release unique positions and parent links before replacing the hierarchy.
      // Negative positions are temporary and never visible outside this transaction.
      for (const [index, row] of current.activities.entries()) {
        await tx.milestoneTemplate.update({ where: { id: row.id }, data: { order: -(index + 1), parentId: null } });
      }
      const kept = inOrder.map((row) => row.id);
      await tx.milestoneTemplate.deleteMany({ where: { id: { notIn: kept } } });
      for (const row of inOrder) {
        const data = { ...row, name: row.name.trim(), relatedCostLines: row.relatedCostLines.map((line) => line.trim()).filter(Boolean) };
        await tx.milestoneTemplate.upsert({ where: { id: row.id }, create: data, update: data });
      }
      return readMilestoneTemplate(principal, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new DomainStaleVersionError("The build sequence changed while saving. Reload it and try again.");
    throw error;
  }
}
