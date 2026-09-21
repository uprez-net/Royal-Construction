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
  changeTeamMemberRole,
  inviteTeamMember,
  revokeTeamInvitation,
} from "@/lib/domain/identity/team";
import { userPrincipal } from "@/lib/domain/principal";
import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
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
import { disconnectXero } from "@/lib/domain/integrations/xero";
import {
  getAdminOfferContent,
  updateAdminOfferContentSection,
} from "@/lib/domain/admin/offer-content";
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
  const incidentResolution =
    input.incidentResolution?.trim() || undefined;
  const resolved = await resolveTradieApproval(
    userPrincipal(actor),
    {
      approvalId: input.approvalId,
      incidentResolution,
      rejectionReason: input.rejectionReason,
      resolution: input.resolution,
    },
    transaction ?? prisma,
  );
  return result(
    "confirmation",
    "Approval resolved",
    `${resolved.actionType.replaceAll("_", " ")} for ${resolved.tradieName} was ${input.resolution}.`,
    {
      approvalId: resolved.approvalId,
      actionType: resolved.actionType,
      resolution: input.resolution,
      affected: resolved.affected,
    },
    {
      entityRef: approvalRef({
        actionType: resolved.actionType,
        id: resolved.approvalId,
      }),
      links: [{ label: "Open approval queue", href: "/admin-approvals" }],
    },
  );
}

export async function getAuthorizedAdminContent(ctx: SessionContext) {
  const actor = await requireCurrentAgentActor(ctx);
  requireAdmin(actor);
  const content = await getAdminOfferContent(userPrincipal(actor), prisma);
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
  const current = await getAdminOfferContent(userPrincipal(actor), prisma);
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
  const version = await updateAdminOfferContentSection(
    userPrincipal(actor),
    {
      data: updateData,
      expectedVersion: input.expectedVersion,
    },
    prisma,
  );
  return result(
    "confirmation",
    "Offer defaults updated",
    `${input.section} was saved as version ${input.expectedVersion + 1}.`,
    { section: input.section, version },
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
  const invitation = await inviteTeamMember(
    userPrincipal(actor),
    { ...input, idempotencyKey: ctx.callId },
    prisma,
    (request) => clerkClient.invitations.createInvitation(request),
  );
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
    // The last-admin guard and the optimistic role check are
    // lib/domain/identity/team.ts. With two or three people on a shared login,
    // demoting the only ADMIN locks the business out of its own admin surface
    // with nobody left who can undo it.
    const updated = await changeTeamMemberRole(
      userPrincipal(actor),
      {
        expectedRole: target.role,
        newRole: input.newRole,
        userId: target.id,
      },
      prisma,
    );
    return result(
      "confirmation",
      "Team role updated",
      `${updated.name}'s role is now ${updated.role}.`,
      { userId: updated.userId, role: updated.role },
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
  const revoked = await revokeTeamInvitation(
    userPrincipal(actor),
    input.invitationId,
    prisma,
    (invitationId) => clerkClient.invitations.revokeInvitation(invitationId),
    ctx.callId,
  );
  return result(
    "confirmation",
    "Invitation revoked",
    "The pending team invitation was revoked.",
    { invitationId: revoked.invitationId },
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
  const context = await getXeroContext();
  const disconnected = await disconnectXero(
    userPrincipal(actor),
    prisma,
    async () => context.xero.revokeToken(),
  );
  if (!disconnected.disconnected)
    throw new Error("No active Xero connection exists.");
  return result(
    "confirmation",
    "Xero disconnected",
    `${disconnected.tenantName ?? "The Xero organisation"} was disconnected.${
      disconnected.revocationFailed
        ? " Xero token revocation was already unavailable; the local connection was deactivated."
        : ""
    }`,
    {
      connectionId: disconnected.connectionId,
      reason: input.reason,
      revocationFailed: disconnected.revocationFailed,
    },
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
