import {
  Prisma,
  Role,
  TradieApprovalActionType,
  TradieApprovalStatus,
} from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import type { SessionContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import { agentDb } from "@/agent/lib/db";
import {
  changeTeamMemberRole,
  inviteTeamMember,
  revokeTeamInvitation,
} from "@/lib/domain/identity/team";
import { userPrincipal } from "@/lib/domain/principal";
import {
  getTradieApproval,
  listTradieApprovals,
  resolveTradieApproval,
} from "@/lib/domain/tradies/approvals";
import { findUserByClerkId, findUserById } from "@/lib/domain/identity/users";
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
  readMilestoneTemplate,
  listTemplateCostTasks,
  editMilestoneTemplate,
} from "@/lib/domain/projects/templates";
import { listTradeTypesForAdmin } from "@/lib/domain/tradies/trade-types";
import type { MilestoneTemplateEdit } from "@/types/milestone-template";
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
  const approvals = await listTradieApprovals(
    userPrincipal(actor),
    input,
    agentDb,
  );
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
        requestedBy: approval.user?.name ?? approval.requestSource ?? "System",
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
  const approval = await getTradieApproval(
    userPrincipal(actor),
    input.approvalId,
    agentDb,
  );
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
        requestedBy: approval.user?.name ?? approval.requestSource ?? "System",
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
  const incidentResolution = input.incidentResolution?.trim() || undefined;
  const resolved = await resolveTradieApproval(
    userPrincipal(actor),
    {
      approvalId: input.approvalId,
      incidentResolution,
      rejectionReason: input.rejectionReason,
      resolution: input.resolution,
    },
    transaction ?? agentDb,
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
  const content = await getAdminOfferContent(userPrincipal(actor), agentDb);
  return result(
    "admin-summary",
    "Offer defaults",
    `Current admin offer content is version ${content.version}.`,
    { content },
  );
}

export async function getAuthorizedBuildSequence(ctx: SessionContext) {
  const actor = await requireCurrentAgentActor(ctx);
  const principal = userPrincipal(actor);
  const [template, trades, costTasks] = await Promise.all([
    readMilestoneTemplate(principal, agentDb),
    listTradeTypesForAdmin(principal, agentDb),
    listTemplateCostTasks(principal, agentDb),
  ]);
  return result(
    "admin-summary",
    "Project build sequence",
    `${template.activities.length} template activities. Changes apply to new projects. Changing an activity's estimated days also updates that activity wherever it is not yet completed on an existing project, and re-plans the activities after it; completed activities keep their dates.`,
    {
      ...template,
      tradeCategories: trades.map(({ id, label, icon, archived }) => ({
        id,
        label,
        icon,
        archived,
      })),
      costTasks,
      scheduling: {
        dayType: "calendar",
        firstTarget: "project start date",
        followingTargets: "Sum of preceding activities' estimatedDays",
        onCompletion:
          "When an activity is completed, each open activity after it is re-planned from the actual completion date.",
        durationChanges:
          "Changing estimatedDays updates linked PENDING and ACTIVE activities on existing projects and re-plans the activities after them.",
      },
    },
    {
      links: [{ label: "Open build sequence", href: "/admin/build-sequence" }],
    },
  );
}

export async function updateAuthorizedBuildSequence(
  ctx: ToolContext,
  input: MilestoneTemplateEdit,
  transaction?: Prisma.TransactionClient,
) {
  // This write must share the audited operation's transaction. Falling back to
  // the ambient client would commit the template separately from its receipt.
  if (!transaction)
    throw new Error("Build sequence changes require an audited transaction.");
  const actor = await requireCurrentAgentActor(ctx, transaction);
  const template = await editMilestoneTemplate(
    userPrincipal(actor),
    input,
    transaction,
  );
  // A changed duration also reaches every open activity on existing projects
  // (issue #422). Eve cannot refresh the app's cache from here -- authored
  // agent code cannot load next/cache -- and project detail is cached with the
  // `max` profile, so the operator is told plainly that the screens lag.
  const durationChanged = input.changes.some(
    (change) =>
      change.type === "update" && change.patch.estimatedDays !== undefined,
  );
  return result(
    "confirmation",
    "Build sequence updated",
    `Saved ${input.changes.length} build sequence change${input.changes.length === 1 ? "" : "s"}. New projects will use this plan.${
      durationChanged
        ? " Changed durations also apply to activities not yet completed on existing projects, and the activities after them are re-planned; completed activities keep their dates. Open project screens may keep showing the previous dates until that project is next updated in the app; saving the build sequence from Admin refreshes them."
        : " Existing projects keep their activities."
    }`,
    { ...template, appliedChanges: input.changes },
    {
      links: [{ label: "Open build sequence", href: "/admin/build-sequence" }],
    },
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
  const current = await getAdminOfferContent(userPrincipal(actor), agentDb);
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
    agentDb,
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
          [user.firstName, user.lastName].filter(Boolean).join(" ")
          || "Unnamed member",
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
    agentDb,
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
  const target = await findUserByClerkId(input.userId, agentDb);
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
      agentDb,
    );
    return result(
      "confirmation",
      "Team role updated",
      `${updated.name}'s role is now ${updated.role}.`,
      { userId: updated.userId, role: updated.role },
    );
  } catch (error) {
    try {
      const current = await findUserById(target.id, agentDb);
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
    agentDb,
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
    agentDb,
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
