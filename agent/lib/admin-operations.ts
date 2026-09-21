import {
  Prisma,
  Role,
  TradieApprovalActionType,
  TradieApprovalStatus,
} from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import type { SessionContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import prisma from "@/lib/prisma";
import {
  AgentAuthorizationError,
  requireCurrentAgentActor,
} from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import {
  agentResultEnvelopeSchema,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";
import { getXeroConnectionStatus } from "@/lib/data/xero-connection";
import { getXeroContext } from "@/lib/xero/client";
import {
  getAdminOfferContentNonCache,
  resolveSingletonId,
} from "@/lib/data/admin-offer-content-writes";
import {
  buildScopeSchema,
  costScheduleDataSchema,
  hbcfClaimDataSchema,
  offerContentDataSchema,
  offerScopeWriteSchema,
} from "@/lib/validations/admin-offer-content";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

function requireAdmin(actor: { role: Role }) {
  if (actor.role !== Role.ADMIN) throw new AgentAuthorizationError();
}

function safe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item instanceof Prisma.Decimal) return item.toString();
      if (item instanceof Date) return item.toISOString();
      return item;
    }),
  );
}

function result(
  kind: "admin-summary" | "confirmation" | "error",
  title: string,
  summary: string,
  data: Record<string, unknown> = {},
  options: Partial<
    Pick<
      AgentResultEnvelope,
      "actions" | "links" | "entityRef" | "requiresApproval"
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
    warnings: [],
    requiresApproval: options.requiresApproval ?? false,
    ...(options.entityRef ? { entityRef: options.entityRef } : {}),
  };
}

function approvalRef(approval: {
  id: string;
  actionType: TradieApprovalActionType;
}) {
  return {
    type: "approval" as const,
    id: approval.id,
    display: {
      label: `${approval.actionType.replaceAll("_", " ")} approval`,
      href: "/admin-approvals",
    },
  };
}

export async function listAuthorizedApprovals(
  ctx: SessionContext,
  input: {
    status?: TradieApprovalStatus;
    actionType?: TradieApprovalActionType;
    query: string;
    limit: number;
  },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const query = input.query.trim();
  const approvals = await prisma.tradieApproval.findMany({
    where: {
      status: input.status,
      actionType: input.actionType,
      ...(query
        ? {
            tradie: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { trade: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: {
      tradie: { select: { id: true, name: true, trade: true } },
      user: { select: { name: true } },
    },
  });
  return result(
    "admin-summary",
    "Admin approvals",
    `${approvals.length} approval request${approvals.length === 1 ? "" : "s"} found.`,
    {
      approvals: approvals.map((approval) => ({
        id: approval.id,
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        createdAt: approval.createdAt.toISOString(),
        tradie: approval.tradie,
        requestedBy: approval.user.name,
        payload: approval.updationData,
      })),
    },
    { links: [{ label: "Open admin approvals", href: "/admin-approvals" }] },
  );
}

export async function getAuthorizedApproval(
  ctx: SessionContext,
  input: { approvalId: string },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const approval = await prisma.tradieApproval.findUnique({
    where: { id: input.approvalId },
    include: {
      tradie: { select: { id: true, name: true, trade: true, email: true } },
      user: { select: { name: true } },
    },
  });
  if (!approval) throw new Error("Approval request not found.");
  return result(
    "admin-summary",
    "Approval request",
    `${approval.actionType.replaceAll("_", " ")} for ${approval.tradie.name} is ${approval.status.toLowerCase()}.`,
    {
      approval: {
        id: approval.id,
        actionType: approval.actionType,
        status: approval.status,
        reason: approval.reason,
        rejectionReason: approval.rejectionReason,
        createdAt: approval.createdAt.toISOString(),
        requestedBy: approval.user.name,
        tradie: approval.tradie,
        payload: approval.updationData,
      },
    },
    {
      entityRef: approvalRef(approval),
      links: [{ label: "Open approval queue", href: "/admin-approvals" }],
    },
  );
}

export async function resolveAuthorizedApproval(
  ctx: ToolContext,
  input: {
    approvalId: string;
    resolution: "approved" | "rejected";
    rejectionReason?: string;
    incidentResolution?: string;
  },
  transaction?: Prisma.TransactionClient,
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const isApproved = input.resolution === "approved";
  if (!isApproved && !input.rejectionReason)
    throw new Error("A rejection reason is required.");
  const resolve = async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.tradieApproval.updateMany({
      where: { id: input.approvalId, status: TradieApprovalStatus.PENDING },
      data: {
        status: isApproved
          ? TradieApprovalStatus.APPROVED
          : TradieApprovalStatus.REJECTED,
        rejectionReason: isApproved ? null : input.rejectionReason,
        pendingDeletionKey: null,
      },
    });
    if (claimed.count !== 1)
      throw new Error(
        "That approval is no longer pending; refresh the queue before deciding.",
      );
    const approval = await tx.tradieApproval.findUnique({
      where: { id: input.approvalId },
      include: { tradie: { select: { id: true, name: true, trade: true } } },
    });
    if (!approval) throw new Error("Approval request not found.");
    if (
      isApproved &&
      approval.actionType === TradieApprovalActionType.INCIDENT_RESOLUTION &&
      !input.incidentResolution
    )
      throw new Error("An incident resolution note is required.");
    const payload = approval.updationData as Record<string, unknown> | null;
    let affected: Record<string, unknown> = {};
    if (isApproved) {
      switch (approval.actionType) {
        case TradieApprovalActionType.PRICE_CHANGE: {
          const amount =
            typeof payload?.newHourlyRate === "number"
              ? payload.newHourlyRate
              : null;
          if (amount === null)
            throw new Error(
              "This price approval has no valid requested amount.",
            );
          await tx.tradie.update({
            where: { id: approval.tradieId },
            data: {
              lastQuotedPrice: amount,
              ...(payload?.newPriceUnit === "HOURLY" ||
              payload?.newPriceUnit === "FIXED"
                ? { lastQuotedPriceUnit: payload.newPriceUnit }
                : {}),
            },
          });
          affected = { amount, unit: payload?.newPriceUnit ?? null };
          break;
        }
        case TradieApprovalActionType.TRADIE_REMOVAL:
          await tx.tradie.delete({ where: { id: approval.tradieId } });
          affected = { deletedTradieId: approval.tradieId };
          break;
        case TradieApprovalActionType.INCIDENT_RESOLUTION: {
          const incidentId =
            typeof payload?.incidentId === "string" ? payload.incidentId : null;
          if (!incidentId)
            throw new Error(
              "This incident approval has no incident reference.",
            );
          const incident = await tx.tradieIncident.findFirst({
            where: { id: incidentId, tradieId: approval.tradieId },
          });
          if (!incident)
            throw new Error("The incident could not be found for this tradie.");
          const updatedIncident = await tx.tradieIncident.update({
            where: { id: incident.id },
            data: { status: "RESOLVED", resolution: input.incidentResolution },
          });
          affected = {
            incidentId: updatedIncident.id,
            status: updatedIncident.status,
          };
          break;
        }
        case TradieApprovalActionType.SCHEDULE_APPROVAL: {
          const scheduleId =
            typeof payload?.scheduleId === "string" ? payload.scheduleId : null;
          if (!scheduleId)
            throw new Error(
              "This schedule approval has no schedule reference.",
            );
          const schedule = await tx.tradieSchedule.findFirst({
            where: { id: scheduleId, tradieId: approval.tradieId },
          });
          if (!schedule)
            throw new Error("The schedule could not be found for this tradie.");
          const updatedSchedule = await tx.tradieSchedule.update({
            where: { id: schedule.id },
            data: { status: "CONFIRMED" },
          });
          affected = {
            scheduleId: updatedSchedule.id,
            status: updatedSchedule.status,
          };
          break;
        }
        case TradieApprovalActionType.SCHEDULE_DELETION: {
          const scheduleId =
            typeof payload?.scheduleId === "string" ? payload.scheduleId : null;
          if (!scheduleId)
            throw new Error(
              "This deletion approval has no schedule reference.",
            );
          const deleted = await tx.tradieSchedule.deleteMany({
            where: { id: scheduleId, tradieId: approval.tradieId },
          });
          affected = { scheduleId, deleted: deleted.count > 0 };
          break;
        }
      }
    } else if (
      approval.actionType === TradieApprovalActionType.SCHEDULE_APPROVAL &&
      typeof payload?.scheduleId === "string"
    ) {
      await tx.tradieSchedule.updateMany({
        where: { id: payload.scheduleId, tradieId: approval.tradieId },
        data: { status: "DECLINED" },
      });
      affected = { scheduleId: payload.scheduleId, status: "DECLINED" };
    }
    return { approval, affected };
  };
  const resolved = transaction
    ? await resolve(transaction)
    : await prisma.$transaction(resolve, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
  return result(
    "confirmation",
    "Approval resolved",
    `${resolved.approval.actionType.replaceAll("_", " ")} for ${resolved.approval.tradie.name} was ${input.resolution}.`,
    {
      approvalId: resolved.approval.id,
      actionType: resolved.approval.actionType,
      resolution: input.resolution,
      affected: resolved.affected,
    },
    {
      entityRef: approvalRef(resolved.approval),
      links: [{ label: "Open approval queue", href: "/admin-approvals" }],
    },
  );
}

export async function getAuthorizedAdminContent(ctx: SessionContext) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const content = await getAdminOfferContentNonCache();
  return result(
    "admin-summary",
    "Offer defaults",
    `Current admin offer content is version ${content.version}.`,
    { content },
  );
}

export async function updateAuthorizedAdminContent(
  ctx: ToolContext,
  input: {
    section:
      | "buildScope"
      | "costSchedule"
      | "offerScope"
      | "offerContent"
      | "hbcfClaim";
    expectedVersion: number;
    data: unknown;
  },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const current = await getAdminOfferContentNonCache();
  if (current.version !== input.expectedVersion)
    throw new Error(
      `Admin offer content changed since review (expected ${input.expectedVersion}, current ${current.version}).`,
    );
  const parsed =
    input.section === "buildScope"
      ? buildScopeSchema.safeParse(input.data)
      : input.section === "costSchedule"
        ? costScheduleDataSchema.safeParse(input.data)
        : input.section === "offerScope"
          ? offerScopeWriteSchema.safeParse(input.data)
          : input.section === "offerContent"
            ? offerContentDataSchema.safeParse(input.data)
            : hbcfClaimDataSchema.safeParse(input.data);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  const id = await resolveSingletonId();
  const updateData: Prisma.AdminOfferContentUpdateManyMutationInput =
    input.section === "buildScope"
      ? { buildScope: parsed.data as string[] }
      : input.section === "costSchedule"
        ? { costSchedule: parsed.data as Prisma.InputJsonValue }
        : input.section === "offerScope"
          ? { offerScope: parsed.data as Prisma.InputJsonValue }
          : input.section === "offerContent"
            ? { offerContent: parsed.data as Prisma.InputJsonValue }
            : { hbcfClaim: parsed.data as Prisma.InputJsonValue };
  const updated = await prisma.adminOfferContent.updateMany({
    where: { id, version: input.expectedVersion },
    data: { ...updateData, version: { increment: 1 } },
  });
  if (updated.count !== 1)
    throw new Error(
      "Admin offer content changed during the update; reload and review again.",
    );
  return result(
    "confirmation",
    "Offer defaults updated",
    `${input.section} was saved as version ${input.expectedVersion + 1}.`,
    { section: input.section, version: input.expectedVersion + 1 },
    {
      links: [
        { label: "Open admin offer content", href: "/admin/offer-content" },
      ],
    },
  );
}

export async function listAuthorizedTeam(
  ctx: SessionContext,
  input: { query: string; limit: number },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const response = await clerkClient.users.getUserList({
    limit: input.limit,
    query: input.query || undefined,
  });
  return result(
    "admin-summary",
    "Team",
    `${response.data.length} team member${response.data.length === 1 ? "" : "s"} found.`,
    {
      members: response.data.map((user) => ({
        id: user.id,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          "Unnamed member",
        email:
          user.emailAddresses.find(
            (email) => email.id === user.primaryEmailAddressId,
          )?.emailAddress ?? null,
        role:
          typeof user.publicMetadata?.role === "string"
            ? user.publicMetadata.role
            : "GUEST",
        updatedAt: user.updatedAt,
      })),
    },
    { links: [{ label: "Open team management", href: "/admin/manage-team" }] },
  );
}

export async function inviteAuthorizedTeamMember(
  ctx: ToolContext,
  input: { email: string; role: Role },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const invitation = await clerkClient.invitations.createInvitation({
    emailAddress: input.email,
    expiresInDays: 7,
    publicMetadata: { role: input.role },
  });
  return result(
    "confirmation",
    "Invitation sent",
    `An invitation was sent to ${input.email} with the ${input.role} role.`,
    { invitationId: invitation.id, email: input.email, role: input.role },
  );
}

export async function updateAuthorizedTeamRole(
  ctx: ToolContext,
  input: { userId: string; newRole: Role },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const target = await prisma.user.findUnique({
    where: { clerkId: input.userId },
    select: { id: true, clerkId: true, role: true, name: true },
  });
  if (!target) throw new Error("Team member not found.");
  if (target.id === actor.id && input.newRole !== Role.ADMIN)
    throw new Error(
      "You cannot remove your own admin access through the agent.",
    );
  if (target.role === input.newRole)
    return result(
      "confirmation",
      "Team role unchanged",
      `${target.name}'s role is already ${target.role}.`,
      { userId: target.id, role: target.role },
    );

  // Clerk is an external system, so update it before the local transaction and
  // compensate if the serialized local role transition cannot commit.
  await clerkClient.users.updateUser(target.clerkId, {
    publicMetadata: { role: input.newRole },
  });
  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: target.id },
          select: { id: true, name: true, role: true },
        });
        if (!current || current.role !== target.role)
          throw new Error(
            "The team member changed during this role update; refresh and retry.",
          );
        if (
          current.role === Role.ADMIN &&
          input.newRole !== Role.ADMIN &&
          (await tx.user.count({ where: { role: Role.ADMIN } })) <= 1
        )
          throw new Error("The last admin cannot be demoted.");
        const changed = await tx.user.updateMany({
          where: { id: current.id, role: target.role },
          data: { role: input.newRole },
        });
        if (changed.count !== 1)
          throw new Error(
            "The team member changed during this role update; refresh and retry.",
          );
        return { id: current.id, name: current.name, role: input.newRole };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return result(
      "confirmation",
      "Team role updated",
      `${updated.name}'s role is now ${updated.role}.`,
      { userId: updated.id, role: updated.role },
    );
  } catch (error) {
    try {
      const current = await prisma.user.findUnique({
        where: { id: target.id },
        select: { role: true },
      });
      await clerkClient.users.updateUser(target.clerkId, {
        publicMetadata: { role: current?.role ?? target.role },
      });
    } catch (compensationError) {
      console.error(
        "Could not compensate a Clerk role update after the local role transition failed",
        compensationError,
      );
      throw new Error(
        "The role update needs manual reconciliation between Clerk and the local team record.",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function revokeAuthorizedTeamInvitation(
  ctx: ToolContext,
  input: { invitationId: string },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  await clerkClient.invitations.revokeInvitation(input.invitationId);
  return result(
    "confirmation",
    "Invitation revoked",
    "The pending team invitation was revoked.",
    { invitationId: input.invitationId },
  );
}

export async function getAuthorizedXero(ctx: SessionContext) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const status = await getXeroConnectionStatus();
  return result(
    "admin-summary",
    "Xero connection",
    status.connected
      ? `Connected to ${status.tenantName ?? "the Xero organisation"}.`
      : "No Xero organisation is connected.",
    {
      connected: status.connected,
      tenantName: status.tenantName,
      connectedByName: status.connectedByName,
      connectedAt: status.connectedAt?.toISOString() ?? null,
      refreshedAt: status.refreshedAt?.toISOString() ?? null,
      refreshTokenExpiresAt:
        status.refreshTokenExpiresAt?.toISOString() ?? null,
      salesAccountCode: status.salesAccountCode,
      connectPath: "/api/xero/connect",
    },
    { links: [{ label: "Open Xero settings", href: "/admin/xero" }] },
  );
}

export async function disconnectAuthorizedXero(
  ctx: ToolContext,
  input: { reason: string },
) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const active = await prisma.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, tenantName: true },
  });
  if (!active) throw new Error("No active Xero connection exists.");
  const context = await getXeroContext();
  try {
    await context.xero.revokeToken();
  } catch {
    /* local deactivation remains the safe fail-closed state */
  }
  await prisma.xeroConnection.update({
    where: { id: active.id },
    data: { isActive: false },
  });
  return result(
    "confirmation",
    "Xero disconnected",
    `${active.tenantName ?? "The Xero organisation"} was disconnected.`,
    { connectionId: active.id, reason: input.reason },
  );
}

export async function runAdminWrite(params: {
  action: string;
  ctx: ToolContext;
  input: Record<string, unknown>;
  targetId?: string;
  targetType: string;
  transactional?: boolean;
  execute: (tx?: Prisma.TransactionClient) => Promise<AgentResultEnvelope>;
}) {
  const actor = await requireCurrentAgentActor(params.ctx);
  return runAuditedAgentOperation({
    action: params.action,
    ctx: params.ctx,
    inputSummary: JSON.parse(
      JSON.stringify(params.input),
    ) as Prisma.InputJsonValue,
    outputSchema: agentResultEnvelopeSchema,
    ownerUserId: actor.id,
    targetId: params.targetId,
    targetType: params.targetType,
    transactional: params.transactional,
    authorize: async (tx) => {
      const current = await requireCurrentAgentActor(params.ctx, tx);
      requireAdmin(current);
    },
    execute: params.execute,
  });
}
