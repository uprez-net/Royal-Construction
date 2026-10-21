import {
  IncidentSeverity,
  Prisma,
  Role,
  TradieIncidentStatus,
  TradiePriceUnit,
  TradieScheduleStatus,
  type User,
} from "@prisma/client";
import type { SessionContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import {
  AgentAuthorizationError,
  requireCurrentAgentActor,
} from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import {
  agentResultEnvelopeSchema,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";
import { authorizeTradie } from "@/lib/domain/access/tradies";
import { authorizeProject } from "@/lib/domain/access/projects";
import { agentDb } from "@/agent/lib/db";
import {
  createTradieSchedule as createTradieScheduleDomain,
  requestTradieScheduleDeletion,
  rescheduleTradieSchedule,
  transitionTradieSchedule,
} from "@/lib/domain/tradies/schedules";
import { reportTradieIncident as reportTradieIncidentDomain } from "@/lib/domain/tradies/incidents";
import {
  createTradie as createTradieDomain,
  rateTradie as rateTradieDomain,
  requestTradiePriceChange,
  requestTradieRemoval,
  updateTradie as updateTradieDomain,
} from "@/lib/domain/tradies/directory";
import {
  getCreatedScheduleSummary,
  getTradieDetail,
  getTradieScheduleDetail,
  listTradieSchedules,
  searchTradies,
} from "@/lib/domain/tradies/queries";

/**
 * Run a domain command and translate its refusals into Eve's own.
 *
 * A refusal is flattened to AgentAuthorizationError so a forbidden tradie is
 * indistinguishable from a missing one; anything else keeps its message.
 */
async function runTradieDomain<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (
      error.code === "domain_unauthorized"
      || error.code === "domain_not_found"
    ) {
      throw new AgentAuthorizationError();
    }
    throw new Error(error.message);
  }
}
import { isDomainError } from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";

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
    return typeof value === "string" && value.length > 4_000
      ? `${value.slice(0, 4_000)}…`
      : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.slice(0, 250).map((item) => safe(item, depth + 1));
  if (value instanceof Prisma.Decimal) return value.toString();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 150)
      .map(([key, item]) => [key, safe(item, depth + 1)]),
  );
}

function envelope(
  kind: "tradie-summary" | "schedule-list" | "confirmation" | "error",
  title: string,
  summary: string,
  data: Record<string, unknown> = {},
  options: Partial<
    Pick<
      AgentResultEnvelope,
      "entityRef" | "actions" | "links" | "warnings" | "requiresApproval"
    >
  > = {},
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
    display: {
      label: tradie.name,
      secondaryText: tradie.trade,
      href: `/tradie-management/${tradie.id}`,
    },
  };
}

function scheduleRef(schedule: {
  id: string;
  tradie: { name: string };
  project: { name: string };
}) {
  return {
    type: "tradieSchedule" as const,
    id: schedule.id,
    display: {
      label: `${schedule.tradie.name} · ${schedule.project.name}`,
      href: "/tradie",
    },
  };
}

function isAdmin(actor: User) {
  return actor.role === Role.ADMIN;
}

function requireAdmin(actor: User) {
  if (!isAdmin(actor)) throw new AgentAuthorizationError();
}

async function getVisibleTradie(
  actor: User,
  tradieId: string,
  db: Prisma.TransactionClient | typeof agentDb = agentDb,
) {
  return runTradieDomain(() =>
    authorizeTradie(userPrincipal(actor), tradieId, db),
  );
}

async function getVisibleSchedule(
  actor: User,
  scheduleId: string,
  db: Prisma.TransactionClient | typeof agentDb = agentDb,
) {
  return runTradieDomain(() =>
    getTradieScheduleDetail(userPrincipal(actor), scheduleId, db),
  );
}

function serializeTradie(tradie: Record<string, unknown>) {
  const value = safe(tradie) as Record<string, unknown>;
  return {
    ...value,
    lastQuotedPrice:
      value.lastQuotedPrice == null ? null : String(value.lastQuotedPrice),
    rating: value.rating == null ? null : String(value.rating),
  };
}

export async function searchAuthorizedTradies(
  ctx: SessionContext,
  input: {
    query: string;
    trade?: string;
    favouriteOnly: boolean;
    limit: number;
  },
) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER)
    throw new AgentAuthorizationError();
  const tradies = await searchTradies(userPrincipal(actor), input, agentDb);
  return envelope(
    "tradie-summary",
    "Tradie directory",
    `${tradies.length} authorized tradie${tradies.length === 1 ? "" : "s"} found.`,
    {
      tradies: tradies.map((tradie) => serializeTradie(tradie)),
      query: input.query,
    },
    {
      links: [{ label: "Open tradie management", href: "/tradie-management" }],
    },
  );
}

export async function getAuthorizedTradie(
  ctx: SessionContext,
  input: { tradieId: string },
) {
  const actor = await requireCurrentAgentActor(ctx);
  const details = await runTradieDomain(() =>
    getTradieDetail(userPrincipal(actor), input.tradieId, agentDb),
  );
  const incidents = details.incidents ?? [];
  const incidentSummary = isAdmin(actor)
    ? `${incidents.filter((i) => i.status === TradieIncidentStatus.OPEN).length} open incident(s)`
    : "incident details restricted";
  return envelope(
    "tradie-summary",
    details.name,
    `${details.trade} tradie with ${details.schedules.filter((s) => s.status === TradieScheduleStatus.COMPLETED).length} completed job(s), ${incidentSummary}, and ${details.schedules.length} recent schedule row(s).`,
    {
      tradie: serializeTradie(details),
      schedules: details.schedules.map((schedule) => ({
        id: schedule.id,
        projectId: schedule.project.id,
        projectName: schedule.project.name,
        milestone: schedule.milestone?.name ?? null,
        scheduledDate: schedule.scheduledDate.toISOString(),
        durationDays: schedule.durationDays,
        status: schedule.status,
        quotedPrice:
          schedule.quotedPrice == null ? null : String(schedule.quotedPrice),
      })),
      incidents,
      ratings: details.ratings.map((rating) => ({
        rating: rating.rating.toString(),
        comment: rating.comment,
        createdAt: rating.createdAt.toISOString(),
        userName: rating.user.name,
      })),
    },
    {
      entityRef: tradieRef(details),
      links: [
        { label: "Open tradie", href: `/tradie-management/${details.id}` },
      ],
    },
  );
}

export async function createAuthorizedTradie(
  ctx: ToolContext,
  input: TradieInput,
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  // lib/domain/tradies/directory.ts owns the rule and its ADMIN guard; the
  // app's createTradie had no guard at all.
  const tradie = await runTradieDomain(() =>
    createTradieDomain(userPrincipal(actor), input, db),
  );
  return envelope(
    "confirmation",
    "Tradie created",
    `${tradie.name} was added to the tradie directory.`,
    { tradie: serializeTradie(tradie) },
    {
      entityRef: tradieRef(tradie),
      links: [
        { label: "Open tradie", href: `/tradie-management/${tradie.id}` },
      ],
    },
  );
}

export async function updateAuthorizedTradie(
  ctx: ToolContext,
  input: { tradieId: string; patch: Record<string, unknown> },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  // The allowlist stays here: it is this tool's contract with the model, not
  // a business rule. The ADMIN guard and the write are the domain's.
  const allowed = [
    "email",
    "additionalEmails",
    "phone",
    "location",
    "note",
    "isFavourite",
  ] as const;
  const patch = Object.fromEntries(
    Object.entries(input.patch).filter(([key]) =>
      (allowed as readonly string[]).includes(key),
    ),
  );
  const updated = await runTradieDomain(() =>
    updateTradieDomain(userPrincipal(actor), input.tradieId, patch, db),
  );
  return envelope(
    "confirmation",
    "Tradie updated",
    `${updated.name}'s directory details were updated.`,
    { tradie: serializeTradie(updated), changedFields: Object.keys(patch) },
    {
      entityRef: tradieRef(updated),
      links: [
        { label: "Open tradie", href: `/tradie-management/${updated.id}` },
      ],
    },
  );
}

export async function requestAuthorizedTradiePriceChange(
  ctx: ToolContext,
  input: {
    tradieId: string;
    amount: number;
    unit: TradiePriceUnit;
    reason: string;
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  const requested = await runTradieDomain(() =>
    requestTradiePriceChange(userPrincipal(actor), input, db),
  );
  const tradie = {
    id: requested.tradieId,
    name: requested.tradieName,
    trade: requested.tradieTrade,
  };
  const approval = { id: requested.approvalId };
  return envelope(
    "confirmation",
    "Price change approval requested",
    `The ${input.unit.toLowerCase()} rate for ${tradie.name} is awaiting admin approval.`,
    {
      approvalId: approval.id,
      tradieId: tradie.id,
      requestedAmount: input.amount,
      unit: input.unit,
    },
    { entityRef: tradieRef(tradie), requiresApproval: false },
  );
}

export async function requestAuthorizedTradieRemoval(
  ctx: ToolContext,
  input: { tradieId: string; reason: string },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  const requested = await runTradieDomain(() =>
    requestTradieRemoval(userPrincipal(actor), input, db),
  );
  const tradie = {
    id: requested.tradieId,
    name: requested.tradieName,
    trade: requested.tradieTrade,
  };
  const approval = { id: requested.approvalId };
  return envelope(
    "confirmation",
    "Tradie removal approval requested",
    `${tradie.name} will remain in the directory until an admin reviews the removal request.`,
    { approvalId: approval.id, tradieId: tradie.id },
    { entityRef: tradieRef(tradie) },
  );
}

export async function reportAuthorizedTradieIncident(
  ctx: ToolContext,
  input: {
    tradieId: string;
    incidentType: string;
    severity: IncidentSeverity;
    description: string;
    fileIds: string[];
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  // lib/domain/tradies/incidents.ts owns this, shared with the app's report
  // modal. This copy matched attachable files on `uploadedBy` alone, so it
  // could move a file already on a project or a lead onto the incident — and
  // File.incidentId cascades, so deleting the incident would delete it.
  const created = await runTradieDomain(() =>
    reportTradieIncidentDomain(
      userPrincipal(actor),
      {
        description: input.description,
        fileIds: input.fileIds,
        incidentType: input.incidentType,
        severity: input.severity,
        tradieId: input.tradieId,
      },
      db,
    ),
  );
  const tradie = {
    id: input.tradieId,
    name: created.tradieName,
    trade: created.tradieTrade,
  };
  return envelope(
    "confirmation",
    "Incident reported",
    `A ${input.severity.toLowerCase()} incident for ${tradie.name} was recorded and queued for resolution review.`,
    { incident: created.incident, approvalId: created.approvalId },
    { entityRef: tradieRef(tradie) },
  );
}

export async function rateAuthorizedTradie(
  ctx: ToolContext,
  input: { tradieId: string; rating: number; comment?: string },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  const rated = await runTradieDomain(() =>
    rateTradieDomain(userPrincipal(actor), input, db),
  );
  const tradie = {
    id: rated.tradieId,
    name: rated.tradieName,
    trade: rated.tradieTrade,
  };
  const average = rated.average ?? 0;
  return envelope(
    "confirmation",
    "Tradie rating recorded",
    `${tradie.name}'s average rating is now ${average.toString()}.`,
    { tradieId: tradie.id, newRating: average.toString() },
    { entityRef: tradieRef(tradie) },
  );
}

export async function listAuthorizedTradieSchedules(
  ctx: SessionContext,
  input: {
    tradieId?: string;
    projectId?: string;
    status?: TradieScheduleStatus;
    query: string;
    from?: string;
    to?: string;
    limit: number;
  },
) {
  const actor = await requireCurrentAgentActor(ctx);
  if (actor.role !== Role.ADMIN && actor.role !== Role.SITE_MANAGER)
    throw new AgentAuthorizationError();
  const schedules = await listTradieSchedules(
    userPrincipal(actor),
    input,
    agentDb,
  );
  return envelope(
    "schedule-list",
    "Tradie schedule",
    `${schedules.length} authorized schedule row${schedules.length === 1 ? "" : "s"} found.`,
    {
      schedules: schedules.map((schedule) => ({
        id: schedule.id,
        tradieId: schedule.tradie.id,
        tradieName: schedule.tradie.name,
        trade: schedule.trade?.trim() || schedule.tradie.trade,
        projectId: schedule.project.id,
        projectName: schedule.project.name,
        milestoneId: schedule.milestone?.id ?? null,
        milestoneName: schedule.milestone?.name ?? null,
        scheduledDate: schedule.scheduledDate.toISOString(),
        durationDays: schedule.durationDays,
        status: schedule.status,
        requiresQuote: schedule.requiresQuote,
        quotedPrice: schedule.quotedPrice?.toString() ?? null,
        reminderSentAt: null,
      })),
    },
    { links: [{ label: "Open tradie coordination", href: "/tradie" }] },
  );
}

// lib/domain/tradies/schedules.ts owns the booking rules, shared with the app.
export async function createAuthorizedTradieSchedule(
  ctx: ToolContext,
  input: {
    tradieId: string;
    projectId: string;
    milestoneId?: string;
    scheduledDate: string;
    durationDays: number;
    requiresQuote: boolean;
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const db = transaction ?? agentDb;
  // Project scope, the milestone-belongs-to-project check and the duplicate
  // booking refusal are all lib/domain/tradies/schedules.ts now, shared with
  // the app. Overlapping days on different work are allowed.
  let created;
  try {
    created = await createTradieScheduleDomain(
      userPrincipal(actor),
      {
        durationDays: input.durationDays,
        milestoneId: input.milestoneId ?? null,
        projectId: input.projectId,
        requiresQuote: input.requiresQuote,
        scheduledDate: new Date(input.scheduledDate),
        tradieId: input.tradieId,
      },
      db,
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (
      error.code === "domain_unauthorized"
      || error.code === "domain_not_found"
    ) {
      throw new AgentAuthorizationError();
    }
    throw new Error(error.message);
  }

  const schedule = await getCreatedScheduleSummary(
    userPrincipal(actor),
    created.id,
    db,
  );
  const tradie = schedule.tradie;
  const project = schedule.project;
  const scheduledDate = schedule.scheduledDate;
  return envelope(
    "confirmation",
    "Tradie scheduled",
    `${tradie.name} is scheduled for ${project.name} starting ${scheduledDate.toISOString().slice(0, 10)}.`,
    {
      schedule: {
        id: schedule.id,
        tradieId: tradie.id,
        projectId: project.id,
        scheduledDate: schedule.scheduledDate.toISOString(),
        durationDays: schedule.durationDays,
        status: schedule.status,
        requiresQuote: schedule.requiresQuote,
        quotedPrice: schedule.quotedPrice?.toString() ?? null,
      },
    },
    {
      entityRef: scheduleRef(schedule),
      links: [{ label: "Open tradie coordination", href: "/tradie" }],
    },
  );
}

export async function transitionAuthorizedTradieSchedule(
  ctx: ToolContext,
  input: {
    scheduleId: string;
    toStatus: TradieScheduleStatus;
    quote?: string;
    quoteUnit?: "FIXED" | "HOURLY" | "DAILY";
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const changed = await runTradieDomain(() =>
    transitionTradieSchedule(
      userPrincipal(actor),
      input,
      transaction ?? agentDb,
    ),
  );
  return envelope(
    "confirmation",
    "Schedule status updated",
    `${changed.tradieName}'s booking for ${changed.projectName} is now ${changed.status}.`,
    {
      scheduleId: changed.scheduleId,
      previousStatus: changed.previousStatus,
      status: changed.status,
      quotedPrice: changed.quotedPrice,
    },
    {
      entityRef: {
        type: "tradieSchedule",
        id: changed.scheduleId,
        display: {
          label: `${changed.tradieName} · ${changed.projectName}`,
          href: "/tradie",
        },
      },
      links: [{ label: "Open tradie coordination", href: "/tradie" }],
    },
  );
}

export async function rescheduleAuthorizedTradie(
  ctx: ToolContext,
  input: {
    scheduleId: string;
    scheduledDate: string;
    durationDays?: number;
    milestoneId?: string | null;
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const changed = await runTradieDomain(() =>
    rescheduleTradieSchedule(
      userPrincipal(actor),
      { ...input, scheduledDate: new Date(input.scheduledDate) },
      transaction ?? agentDb,
    ),
  );
  // Eve has no mailbox, so the email the tradie is now owed is not sent from
  // here. Say so in the summary: a booking quietly moved under a tradie who
  // was never told is the failure nobody notices until the day.
  const owed =
    changed.notice === "reconfirm-attendance"
      ? ` The booking is still approved, but ${changed.tradieName} has not been told about the new date — send them a reminder from the project's Tradies tab so they can confirm it.`
      : changed.notice === "confirm-availability"
        ? ` ${changed.tradieName} has not been told about the new date — send them a reminder from the project's Tradies tab asking them to confirm their availability.${changed.withdrewApproval ? " The approval waiting for the old date was withdrawn; their confirmation for the new date will raise a fresh one." : ""}`
        : "";
  return envelope(
    "confirmation",
    "Tradie booking rescheduled",
    `${changed.tradieName}'s booking for ${changed.projectName} now starts ${changed.scheduledDate.toISOString().slice(0, 10)}.${owed}`,
    {
      scheduleId: changed.scheduleId,
      scheduledDate: changed.scheduledDate.toISOString(),
      durationDays: changed.durationDays,
      status: changed.status,
      previousStatus: changed.previousStatus,
      tradieNotified: false,
    },
    {
      entityRef: {
        type: "tradieSchedule",
        id: changed.scheduleId,
        display: {
          label: `${changed.tradieName} · ${changed.projectName}`,
          href: "/tradie",
        },
      },
      links: [{ label: "Open tradie coordination", href: "/tradie" }],
    },
  );
}

export async function requestAuthorizedScheduleDeletion(
  ctx: ToolContext,
  input: { scheduleId: string; reason: string },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  const requested = await runTradieDomain(() =>
    requestTradieScheduleDeletion(
      userPrincipal(actor),
      input,
      transaction ?? agentDb,
    ),
  );
  return envelope(
    "confirmation",
    "Schedule deletion approval requested",
    `The booking for ${requested.tradieName} on ${requested.projectName} remains in place until an admin reviews the request.`,
    {
      approvalId: requested.approvalId,
      scheduleId: requested.scheduleId,
      currentStatus: requested.status,
    },
    {
      entityRef: {
        type: "tradieSchedule",
        id: requested.scheduleId,
        display: {
          label: `${requested.tradieName} · ${requested.projectName}`,
          href: "/tradie",
        },
      },
    },
  );
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
  if (
    action === "tradie.update"
    || action === "tradie.price-change.request"
    || action === "tradie.removal.request"
  ) {
    requireAdmin(actor);
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    return;
  }
  if (action === "tradie.incident.report") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER)
      throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    const fileIds = Array.isArray(input.fileIds)
      ? input.fileIds.filter((id): id is string => typeof id === "string")
      : [];
    if (
      fileIds.length
      !== (Array.isArray(input.fileIds) ? input.fileIds.length : 0)
    )
      throw new AgentAuthorizationError();
    // File ownership and attachment state are checked atomically by the
    // incident command. The audit preflight only establishes actor/tradie
    // scope; repeating a weaker file query here was the divergence #301 fixed.
    return;
  }
  if (action === "tradie.rating.create") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER)
      throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    return;
  }
  if (action === "tradie.schedule.create") {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER)
      throw new AgentAuthorizationError();
    await getVisibleTradie(actor, inputString(input, "tradieId"), transaction);
    await runTradieDomain(() =>
      authorizeProject(
        userPrincipal(actor),
        inputString(input, "projectId"),
        transaction,
      ),
    );
    return;
  }
  if (
    action === "tradie.schedule.transition"
    || action === "tradie.schedule.reschedule"
    || action === "tradie.schedule.deletion.request"
  ) {
    if (!isAdmin(actor) && actor.role !== Role.SITE_MANAGER)
      throw new AgentAuthorizationError();
    await getVisibleSchedule(
      actor,
      inputString(input, "scheduleId"),
      transaction,
    );
    return;
  }
  throw new AgentAuthorizationError();
}

export async function runTradieWrite(params: {
  action: string;
  ctx: ToolContext;
  input: Record<string, unknown>;
  targetId?: string;
  targetType: string;
  targetIdFromOutput?: (output: AgentResultEnvelope) => string | undefined;
  authorize: (tx: Prisma.TransactionClient) => Promise<void>;
  execute: (tx?: Prisma.TransactionClient) => Promise<AgentResultEnvelope>;
}) {
  const actor = await requireCurrentAgentActor(params.ctx);
  return runAuditedAgentOperation({
    action: params.action,
    ctx: params.ctx,
    inputSummary: safe(params.input) as Prisma.InputJsonValue,
    outputSchema: agentResultEnvelopeSchema,
    ownerUserId: actor.id,
    targetId: params.targetId,
    targetType: params.targetType,
    targetIdFromOutput: params.targetIdFromOutput,
    authorize: params.authorize,
    execute: params.execute,
  });
}
