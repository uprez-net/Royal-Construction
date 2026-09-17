import {
  IncidentSeverity,
  Prisma,
  Role,
  TradieApprovalActionType,
  TradieIncidentStatus,
  TradiePriceUnit,
  TradieScheduleStatus,
  type User,
} from "@prisma/client";
import type { SessionContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import { AgentAuthorizationError, requireCurrentAgentActor } from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { agentResultEnvelopeSchema, type AgentResultEnvelope } from "@/agent/lib/result-contracts";
import prisma from "@/lib/prisma";
import {
  normalizeQuoteBasis,
  parseQuotedAmount,
  scheduleTotalCost,
} from "@/utils/calculations";
import { TRADIE_SCHEDULE_STATE_MACHINE } from "@/types/tradie";

type TradieInput = {
  name: string;
  trade: string;
  abn: string;
  phone: string;
  email: string;
  additionalEmails?: string[];
  location?: string;
  note?: string;
  lastQuotedPrice?: number;
  lastQuotedPriceUnit: TradiePriceUnit;
};

function safe(value: unknown, depth = 0): unknown {
  if (depth > 7 || value === null || typeof value !== "object") {
    return typeof value === "string" && value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => safe(item, depth + 1));
  if (value instanceof Prisma.Decimal) return value.toString();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).slice(0, 150).map(([key, item]) => [key, safe(item, depth + 1)]),
  );
}

function envelope(
  kind: "tradie-summary" | "schedule-list" | "confirmation" | "error",
  title: string,
  summary: string,
  data: Record<string, unknown> = {},
  options: Partial<Pick<AgentResultEnvelope, "entityRef" | "actions" | "links" | "warnings" | "requiresApproval">> = {},
): AgentResultEnvelope {
  return {
    version: 1,
    kind,
    title,
    summary,
    data: safe(data) as AgentResultEnvelope["data"],
    actions: options.actions ?? [],
    links: options.links ?? [],
    warnings: options.warnings ?? [],
    requiresApproval: options.requiresApproval ?? false,
    ...(options.entityRef ? { entityRef: options.entityRef } : {}),
  };
}

function tradieRef(tradie: { id: string; name: string; trade: string }) {
  return {
    type: "tradie" as const,
    id: tradie.id,
    display: { label: tradie.name, secondaryText: tradie.trade, href: `/tradie-management/${tradie.id}` },
  };
}

function scheduleRef(schedule: { id: string; tradie: { name: string }; project: { name: string } }) {
  return {
    type: "tradieSchedule" as const,
    id: schedule.id,
    display: { label: `${schedule.tradie.name} · ${schedule.project.name}`, href: "/tradie" },
  };
}

function isAdmin(actor: User) {
  return actor.role === Role.ADMIN;
}

function requireAdmin(actor: User) {
  if (!isAdmin(actor)) throw new AgentAuthorizationError();
}

function scopeForTradie(actor: User): Prisma.TradieWhereInput {
  // Directory lookup is an internal coordination surface. Site managers may
  // select any registered tradie for a booking; project scope is enforced on
  // the schedule/project mutation itself.
  return isAdmin(actor) || actor.role === Role.SITE_MANAGER ? {} : { id: "__unreachable__" };
}

async function getVisibleTradie(actor: User, tradieId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const tradie = await db.tradie.findFirst({ where: { id: tradieId, ...scopeForTradie(actor) } });
  if (!tradie) throw new AgentAuthorizationError();
  return tradie;
}

async function getVisibleSchedule(actor: User, scheduleId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const schedule = await db.tradieSchedule.findFirst({
    where: {
      id: scheduleId,
      ...(isAdmin(actor) ? {} : { project: { siteManagerId: actor.id } }),
    },
    include: { tradie: true, project: { select: { id: true, name: true, siteManagerId: true } }, milestone: true },
  });
  if (!schedule) throw new AgentAuthorizationError();
  return schedule;
}

function serializeTradie(tradie: Record<string, unknown>) {
  const value = safe(tradie) as Record<string, unknown>;
  return {
    ...value,
    lastQuotedPrice: value.lastQuotedPrice == null ? null : String(value.lastQuotedPrice),
    rating: value.rating == null ? null : String(value.rating),
  };
}

export async function searchAuthorizedTradies(ctx: SessionContext, input: { query: string; trade?: string; favouriteOnly: boolean; limit: number }) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
  const query = input.query.trim();
  const tradies = await prisma.tradie.findMany({
    where: {
      ...scopeForTradie(actor),
      trade: input.trade ? { equals: input.trade, mode: "insensitive" } : undefined,
      isFavourite: input.favouriteOnly ? true : undefined,
      ...(query ? { OR: [
        { name: { contains: query, mode: "insensitive" } },
        { trade: { contains: query, mode: "insensitive" } },
        { abn: { contains: query, mode: "insensitive" } },
      ] } : {}),
    },
    orderBy: [{ isFavourite: "desc" }, { name: "asc" }],
    take: input.limit,
    select: { id: true, name: true, trade: true, abn: true, email: true, phone: true, isFavourite: true, lastQuotedPrice: true, lastQuotedPriceUnit: true, rating: true, note: true },
  });
  return envelope("tradie-summary", "Tradie directory", `${tradies.length} authorized tradie${tradies.length === 1 ? "" : "s"} found.`, {
    tradies: tradies.map((tradie) => serializeTradie(tradie)),
    query: input.query,
  }, { links: [{ label: "Open tradie management", href: "/tradie-management" }] });
}

export async function getAuthorizedTradie(ctx: SessionContext, input: { tradieId: string }) {
  const actor = await requireCurrentAgentActor(ctx);
  const tradie = await getVisibleTradie(actor, input.tradieId);
  const details = await prisma.tradie.findUnique({
    where: { id: tradie.id },
    include: {
      ratings: { orderBy: { createdAt: "desc" }, take: 25, include: { user: { select: { name: true } } } },
      incidents: actor.role === Role.ADMIN ? { orderBy: { createdAt: "desc" }, take: 25 } : false,
      schedules: { where: actor.role === Role.ADMIN ? undefined : { project: { siteManagerId: actor.id } }, orderBy: { scheduledDate: "desc" }, take: 50, include: { project: { select: { id: true, name: true } }, milestone: { select: { id: true, name: true } } } },
    },
  });
  if (!details) throw new AgentAuthorizationError();
  const incidents = details.incidents ?? [];
  const incidentSummary = isAdmin(actor)
    ? `${incidents.filter((i) => i.status === TradieIncidentStatus.OPEN).length} open incident(s)`
    : "incident details restricted";
  return envelope("tradie-summary", details.name, `${details.trade} tradie with ${details.schedules.filter((s) => s.status === TradieScheduleStatus.COMPLETED).length} completed job(s), ${incidentSummary}, and ${details.schedules.length} recent schedule row(s).`, {
    tradie: serializeTradie(details),
    schedules: details.schedules.map((schedule) => ({ id: schedule.id, projectId: schedule.project.id, projectName: schedule.project.name, milestone: schedule.milestone?.name ?? null, scheduledDate: schedule.scheduledDate.toISOString(), durationDays: schedule.durationDays, status: schedule.status, quotedPrice: schedule.quotedPrice == null ? null : String(schedule.quotedPrice) })),
    incidents,
    ratings: details.ratings.map((rating) => ({ rating: rating.rating.toString(), comment: rating.comment, createdAt: rating.createdAt.toISOString(), userName: rating.user.name })),
  }, { entityRef: tradieRef(details), links: [{ label: "Open tradie", href: `/tradie-management/${details.id}` }] });
}

export async function createAuthorizedTradie(ctx: ToolContext, input: TradieInput, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const db = transaction ?? prisma;
  const tradie = await db.tradie.create({ data: {
    name: input.name, trade: input.trade, abn: input.abn, phone: input.phone, email: input.email,
    additionalEmails: input.additionalEmails ?? [], location: input.location ?? null, note: input.note ?? null,
    lastQuotedPrice: input.lastQuotedPrice ?? null, lastQuotedPriceUnit: input.lastQuotedPriceUnit,
  } });
  return envelope("confirmation", "Tradie created", `${tradie.name} was added to the tradie directory.`, { tradie: serializeTradie(tradie) }, { entityRef: tradieRef(tradie), links: [{ label: "Open tradie", href: `/tradie-management/${tradie.id}` }] });
}

export async function updateAuthorizedTradie(ctx: ToolContext, input: { tradieId: string; patch: Record<string, unknown> }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const db = transaction ?? prisma;
  await getVisibleTradie(actor, input.tradieId, db);
  const allowed = ["email", "additionalEmails", "phone", "location", "note", "isFavourite"] as const;
  const patch = Object.fromEntries(Object.entries(input.patch).filter(([key]) => (allowed as readonly string[]).includes(key))) as Prisma.TradieUpdateInput;
  const updated = await db.tradie.update({ where: { id: input.tradieId }, data: patch });
  return envelope("confirmation", "Tradie updated", `${updated.name}'s directory details were updated.`, { tradie: serializeTradie(updated), changedFields: Object.keys(patch) }, { entityRef: tradieRef(updated), links: [{ label: "Open tradie", href: `/tradie-management/${updated.id}` }] });
}

export async function requestAuthorizedTradiePriceChange(ctx: ToolContext, input: { tradieId: string; amount: number; unit: TradiePriceUnit; reason: string }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const db = transaction ?? prisma;
  const tradie = await getVisibleTradie(actor, input.tradieId, db);
  const approval = await db.tradieApproval.create({ data: { tradieId: tradie.id, actionType: TradieApprovalActionType.PRICE_CHANGE, reason: input.reason, requestedBy: actor.id, updationData: { newHourlyRate: input.amount, newPriceUnit: input.unit } } });
  return envelope("confirmation", "Price change approval requested", `The ${input.unit.toLowerCase()} rate for ${tradie.name} is awaiting admin approval.`, { approvalId: approval.id, tradieId: tradie.id, requestedAmount: input.amount, unit: input.unit }, { entityRef: tradieRef(tradie), requiresApproval: false });
}

export async function requestAuthorizedTradieRemoval(ctx: ToolContext, input: { tradieId: string; reason: string }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const db = transaction ?? prisma;
  const tradie = await getVisibleTradie(actor, input.tradieId, db);
  const approval = await db.tradieApproval.create({ data: { tradieId: tradie.id, actionType: TradieApprovalActionType.TRADIE_REMOVAL, reason: input.reason, requestedBy: actor.id } });
  return envelope("confirmation", "Tradie removal approval requested", `${tradie.name} will remain in the directory until an admin reviews the removal request.`, { approvalId: approval.id, tradieId: tradie.id }, { entityRef: tradieRef(tradie) });
}

export async function reportAuthorizedTradieIncident(ctx: ToolContext, input: { tradieId: string; incidentType: string; severity: IncidentSeverity; description: string; fileIds: string[] }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
  const db = transaction ?? prisma;
  const tradie = await getVisibleTradie(actor, input.tradieId, db);
  const files = input.fileIds.length ? await db.file.findMany({ where: { id: { in: input.fileIds }, uploadedBy: actor.id }, select: { id: true } }) : [];
  if (files.length !== input.fileIds.length) throw new Error("One or more incident files are unavailable to this caller.");
  const create = async (tx: Prisma.TransactionClient | typeof prisma) => {
    const incident = await tx.tradieIncident.create({ data: { tradieId: tradie.id, type: input.incidentType, severity: input.severity, description: input.description, files: files.length ? { connect: files.map((file) => ({ id: file.id })) } : undefined } });
    const approval = await tx.tradieApproval.create({ data: { tradieId: tradie.id, actionType: TradieApprovalActionType.INCIDENT_RESOLUTION, reason: input.description, requestedBy: actor.id, updationData: { incidentId: incident.id, incidentType: input.incidentType, incidentSeverity: input.severity, incidentDescription: input.description } } });
    return { incident, approval };
  };
  const created = transaction ? await create(transaction) : await prisma.$transaction(create);
  return envelope("confirmation", "Incident reported", `A ${input.severity.toLowerCase()} incident for ${tradie.name} was recorded and queued for resolution review.`, { incident: created.incident, approvalId: created.approval.id }, { entityRef: tradieRef(tradie) });
}

export async function rateAuthorizedTradie(ctx: ToolContext, input: { tradieId: string; rating: number; comment?: string }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
  const db = transaction ?? prisma;
  const tradie = await getVisibleTradie(actor, input.tradieId, db);
  await db.tradieRating.create({ data: { tradieId: tradie.id, userId: actor.id, rating: input.rating, comment: input.comment ?? null } });
  const average = await db.tradieRating.aggregate({ where: { tradieId: tradie.id }, _avg: { rating: true } });
  await db.tradie.update({ where: { id: tradie.id }, data: { rating: average._avg.rating ?? 0 } });
  return envelope("confirmation", "Tradie rating recorded", `${tradie.name}'s average rating is now ${(average._avg.rating ?? 0).toString()}.`, { tradieId: tradie.id, newRating: (average._avg.rating ?? 0).toString() }, { entityRef: tradieRef(tradie) });
}

function scheduleWhere(actor: User, input: { tradieId?: string; projectId?: string; status?: TradieScheduleStatus; query: string; from?: string; to?: string }): Prisma.TradieScheduleWhereInput {
  return {
    tradieId: input.tradieId,
    projectId: input.projectId,
    status: input.status,
    ...(isAdmin(actor) ? {} : { project: { siteManagerId: actor.id } }),
    ...(input.from || input.to ? { scheduledDate: { gte: input.from ? new Date(input.from) : undefined, lt: input.to ? new Date(input.to) : undefined } } : {}),
    ...(input.query ? { OR: [
      { tradie: { name: { contains: input.query, mode: "insensitive" } } },
      { tradie: { trade: { contains: input.query, mode: "insensitive" } } },
      { project: { name: { contains: input.query, mode: "insensitive" } } },
      { milestone: { name: { contains: input.query, mode: "insensitive" } } },
    ] } : {}),
  };
}

export async function listAuthorizedTradieSchedules(ctx: SessionContext, input: { tradieId?: string; projectId?: string; status?: TradieScheduleStatus; query: string; from?: string; to?: string; limit: number }) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
  const schedules = await prisma.tradieSchedule.findMany({ where: scheduleWhere(actor, input), orderBy: { scheduledDate: "asc" }, take: input.limit, include: { tradie: { select: { id: true, name: true, trade: true, email: true } }, project: { select: { id: true, name: true, siteManagerId: true } }, milestone: { select: { id: true, name: true } } } });
  return envelope("schedule-list", "Tradie schedule", `${schedules.length} authorized schedule row${schedules.length === 1 ? "" : "s"} found.`, { schedules: schedules.map((schedule) => ({ id: schedule.id, tradieId: schedule.tradie.id, tradieName: schedule.tradie.name, trade: schedule.tradie.trade, projectId: schedule.project.id, projectName: schedule.project.name, milestoneId: schedule.milestone?.id ?? null, milestoneName: schedule.milestone?.name ?? null, scheduledDate: schedule.scheduledDate.toISOString(), durationDays: schedule.durationDays, status: schedule.status, requiresQuote: schedule.requiresQuote, quotedPrice: schedule.quotedPrice?.toString() ?? null, reminderSentAt: null })) }, { links: [{ label: "Open tradie coordination", href: "/tradie" }] });
}

async function ensureNoScheduleConflict(tradieId: string, scheduledDate: Date, durationDays: number, ignoreId?: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const end = new Date(scheduledDate);
  end.setUTCDate(end.getUTCDate() + durationDays);
  const candidates = await db.tradieSchedule.findMany({ where: { tradieId, id: ignoreId ? { not: ignoreId } : undefined, status: { notIn: [TradieScheduleStatus.DECLINED, TradieScheduleStatus.COMPLETED] }, scheduledDate: { lt: end } }, select: { id: true, scheduledDate: true, durationDays: true } });
  const conflict = candidates.find((candidate) => { const candidateEnd = new Date(candidate.scheduledDate); candidateEnd.setUTCDate(candidateEnd.getUTCDate() + candidate.durationDays); return candidateEnd > scheduledDate; });
  if (conflict) throw new Error("That tradie already has an overlapping active booking in the requested window.");
}

export async function createAuthorizedTradieSchedule(ctx: ToolContext, input: { tradieId: string; projectId: string; milestoneId?: string; scheduledDate: string; durationDays: number; requiresQuote: boolean }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? prisma;
  const tradie = await db.tradie.findUnique({ where: { id: input.tradieId } });
  if (!tradie) throw new AgentAuthorizationError();
  const project = await db.project.findFirst({ where: { id: input.projectId, ...(isAdmin(actor) ? {} : { siteManagerId: actor.id }) }, select: { id: true, name: true, siteManagerId: true } });
  if (!project) throw new AgentAuthorizationError();
  if (input.milestoneId) {
    const milestone = await db.milestone.findFirst({ where: { id: input.milestoneId, projectId: project.id }, select: { id: true } });
    if (!milestone) throw new Error("Milestone does not belong to the selected project.");
  }
  const scheduledDate = new Date(input.scheduledDate);
  await ensureNoScheduleConflict(tradie.id, scheduledDate, input.durationDays, undefined, db);
  const schedule = await db.tradieSchedule.create({ data: { tradieId: tradie.id, projectId: project.id, milestoneId: input.milestoneId ?? null, scheduledDate, durationDays: input.durationDays, requiresQuote: input.requiresQuote, status: input.requiresQuote ? TradieScheduleStatus.AWAITING_QUOTE : TradieScheduleStatus.PENDING }, include: { tradie: { select: { id: true, name: true, trade: true } }, project: { select: { id: true, name: true } } } });
  return envelope("confirmation", "Tradie scheduled", `${tradie.name} is scheduled for ${project.name} starting ${scheduledDate.toISOString().slice(0, 10)}.`, { schedule: { id: schedule.id, tradieId: tradie.id, projectId: project.id, scheduledDate: schedule.scheduledDate.toISOString(), durationDays: schedule.durationDays, status: schedule.status, requiresQuote: schedule.requiresQuote, quotedPrice: schedule.quotedPrice?.toString() ?? null } }, { entityRef: scheduleRef(schedule), links: [{ label: "Open tradie coordination", href: "/tradie" }] });
}

export async function transitionAuthorizedTradieSchedule(ctx: ToolContext, input: { scheduleId: string; toStatus: TradieScheduleStatus; quote?: string; quoteUnit?: "FIXED" | "HOURLY" | "DAILY" }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? prisma;
  const existing = await getVisibleSchedule(actor, input.scheduleId, db);
  if (!TRADIE_SCHEDULE_STATE_MACHINE[existing.status].includes(input.toStatus)) throw new Error(`Invalid schedule transition from ${existing.status} to ${input.toStatus}.`);
  const quoteAmount = input.quote ? parseQuotedAmount(input.quote) : null;
  if (input.quote && quoteAmount === null) throw new Error("The quote must contain exactly one non-negative money amount.");
  const normalized = quoteAmount === null ? null : normalizeQuoteBasis(quoteAmount, input.quoteUnit ?? "FIXED");
  const data: Prisma.TradieScheduleUpdateInput = { status: input.toStatus };
  if (normalized) { data.quotedPrice = scheduleTotalCost(normalized.amount, existing.durationDays, normalized.unit).toFixed(2); data.requiresQuote = true; }
  const updatedCount = await db.tradieSchedule.updateMany({ where: { id: existing.id, status: existing.status }, data });
  if (updatedCount.count !== 1) throw new Error("The schedule changed before this transition was applied.");
  const updated = await db.tradieSchedule.findUniqueOrThrow({ where: { id: existing.id }, include: { tradie: { select: { id: true, name: true, trade: true } }, project: { select: { id: true, name: true } } } });
  if (normalized) await db.tradie.update({ where: { id: existing.tradieId }, data: { lastQuotedPrice: normalized.amount, lastQuotedPriceUnit: normalized.unit === "HOURLY" ? TradiePriceUnit.HOURLY : TradiePriceUnit.FIXED } });
  return envelope("confirmation", "Schedule status updated", `${updated.tradie.name}'s booking for ${updated.project.name} is now ${updated.status}.`, { scheduleId: updated.id, previousStatus: existing.status, status: updated.status, quotedPrice: updated.quotedPrice?.toString() ?? null }, { entityRef: scheduleRef(updated), links: [{ label: "Open tradie coordination", href: "/tradie" }] });
}

export async function rescheduleAuthorizedTradie(ctx: ToolContext, input: { scheduleId: string; scheduledDate: string; durationDays?: number; milestoneId?: string | null }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? prisma;
  const existing = await getVisibleSchedule(actor, input.scheduleId, db);
  const durationDays = input.durationDays ?? existing.durationDays;
  const scheduledDate = new Date(input.scheduledDate);
  if (input.milestoneId) {
    const milestone = await db.milestone.findFirst({ where: { id: input.milestoneId, projectId: existing.project.id }, select: { id: true } });
    if (!milestone) throw new Error("Milestone does not belong to this project.");
  }
  await ensureNoScheduleConflict(existing.tradieId, scheduledDate, durationDays, existing.id, db);
  const updatedCount = await db.tradieSchedule.updateMany({ where: { id: existing.id, scheduledDate: existing.scheduledDate, durationDays: existing.durationDays }, data: { scheduledDate, durationDays, ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}) } });
  if (updatedCount.count !== 1) throw new Error("The schedule changed before it could be rescheduled.");
  const updated = await db.tradieSchedule.findUniqueOrThrow({ where: { id: existing.id }, include: { tradie: { select: { id: true, name: true, trade: true } }, project: { select: { id: true, name: true } } } });
  return envelope("confirmation", "Tradie booking rescheduled", `${updated.tradie.name}'s booking for ${updated.project.name} now starts ${scheduledDate.toISOString().slice(0, 10)}.`, { scheduleId: updated.id, scheduledDate: updated.scheduledDate.toISOString(), durationDays: updated.durationDays }, { entityRef: scheduleRef(updated), links: [{ label: "Open tradie coordination", href: "/tradie" }] });
}

export async function requestAuthorizedScheduleDeletion(ctx: ToolContext, input: { scheduleId: string; reason: string }, transaction?: Prisma.TransactionClient) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? prisma;
  const schedule = await getVisibleSchedule(actor, input.scheduleId, db);
  let approval;
  try {
    approval = await db.tradieApproval.create({ data: { tradieId: schedule.tradieId, actionType: TradieApprovalActionType.SCHEDULE_DELETION, pendingDeletionKey: schedule.id, reason: input.reason, requestedBy: actor.id, updationData: { scheduleId: schedule.id, projectId: schedule.project.id, projectName: schedule.project.name, scheduledDate: schedule.scheduledDate.toISOString(), durationDays: schedule.durationDays, currentStatus: schedule.status } } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("A deletion request for this schedule is already pending.");
    throw error;
  }
  return envelope("confirmation", "Schedule deletion approval requested", `The booking for ${schedule.tradie.name} on ${schedule.project.name} remains in place until an admin reviews the request.`, { approvalId: approval.id, scheduleId: schedule.id, currentStatus: schedule.status }, { entityRef: scheduleRef(schedule) });
}

function inputString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string") throw new AgentAuthorizationError();
  return value;
}

export async function authorizeTradieWrite(
  ctx: ToolContext,
  action: string,
  input: Record<string, unknown>,
  transaction: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx, transaction);
  if (action === "tradie.create") {
    requireAdmin(actor);
    return;
  }
  if (action === "tradie.update" || action === "tradie.price-change.request" || action === "tradie.removal.request") {
    requireAdmin(actor);
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    return;
  }
  if (action === "tradie.incident.report") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    const fileIds = Array.isArray(input.fileIds) ? input.fileIds.filter((id): id is string => typeof id === "string") : [];
    if (fileIds.length !== (Array.isArray(input.fileIds) ? input.fileIds.length : 0)) throw new AgentAuthorizationError();
    if (fileIds.length > 0) {
      const files = await transaction.file.findMany({ where: { id: { in: fileIds }, uploadedBy: actor.id }, select: { id: true } });
      if (files.length !== fileIds.length) throw new AgentAuthorizationError();
    }
    return;
  }
  if (action === "tradie.rating.create") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    return;
  }
  if (action === "tradie.schedule.create") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    const project = await transaction.project.findFirst({ where: { id: inputString(input, "projectId"), ...(isAdmin(actor) ? {} : { siteManagerId: actor.id }) }, select: { id: true } });
    if (!project) throw new AgentAuthorizationError();
    return;
  }
  if (action === "tradie.schedule.transition" || action === "tradie.schedule.reschedule" || action === "tradie.schedule.deletion.request") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER) throw new AgentAuthorizationError();
    await getVisibleSchedule(actor, inputString(input, "scheduleId"), transaction);
    return;
  }
  throw new AgentAuthorizationError();
}

export async function runTradieWrite(params: { action: string; ctx: ToolContext; input: Record<string, unknown>; targetId?: string; targetType: string; targetIdFromOutput?: (output: AgentResultEnvelope) => string | undefined; authorize: (tx: Prisma.TransactionClient) => Promise<void>; execute: (tx?: Prisma.TransactionClient) => Promise<AgentResultEnvelope> }) {
  const actor = await requireCurrentAgentActor(params.ctx);
  return runAuditedAgentOperation({ action: params.action, ctx: params.ctx, inputSummary: safe(params.input) as Prisma.InputJsonValue, outputSchema: agentResultEnvelopeSchema, ownerUserId: actor.id, targetId: params.targetId, targetType: params.targetType, targetIdFromOutput: params.targetIdFromOutput, authorize: params.authorize, execute: params.execute });
}
