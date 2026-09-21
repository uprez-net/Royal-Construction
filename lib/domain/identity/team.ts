import {
  OutboxEventKind,
  OutboxEventStatus,
  Prisma,
  Role,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import {
  describePrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import {
  enqueueOutboxEvent,
  runOutboxEffect,
  runOutboxEffectWithOutcome,
} from "../outbox";

// Changing a team member's role.
//
// Royal Constructions has two or three people sharing one or two logins, and
// everyone is an ADMIN. That is exactly why the last-admin guard matters more
// here than it would at a larger company: demote the only ADMIN and the
// business is locked out of its own admin surface, with nobody left who can
// undo it and no support team to call.
//
// Eve had the guard. Nothing else did.

export type RoleChangeResult = {
  readonly userId: string;
  readonly name: string;
  readonly role: Role;
};

export type TeamInvitationInput = {
  readonly email: string;
  readonly role: Role;
  /** Stable request id from the App Idempotency-Key header or Eve call id. */
  readonly idempotencyKey?: string;
  /** Overridable so a test does not depend on the wall clock. */
  readonly now?: Date;
};

export type TeamInvitation = {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
};

export type TeamInvitationPort = (input: {
  emailAddress: string;
  expiresInDays: number;
  publicMetadata: { role: Role };
}) => Promise<{ id: string }>;

export type TeamInvitationRevokePort = (
  invitationId: string,
) => Promise<unknown>;

/**
 * Invite through an injected Clerk capability after one shared admin check.
 *
 * When the caller supplies no key the fallback is scoped to the day. An
 * invitation is not idempotent on (email, role) for ever: a Clerk invitation
 * expires after seven days and can be revoked, so a permanent key meant the
 * second invitation to the same person at the same role was never sent while
 * the API answered "Invitation sent successfully" — and with nobody watching
 * logs here, the first sign would be a new starter saying they never got an
 * email. A day still covers the double-submit the guard exists for.
 */
export async function inviteTeamMember(
  principal: DomainPrincipal,
  input: TeamInvitationInput,
  db: DomainDb,
  invite: TeamInvitationPort,
): Promise<TeamInvitation & { alreadyInvited: boolean }> {
  requireAdminPrincipal(principal);
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new DomainValidationError(
      "A valid invitation email is required.",
      "email",
    );
  }
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const operationKey =
    input.idempotencyKey?.trim() || `${day}:${email}:${input.role}`;
  const { replayed, result } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `team-invite:${operationKey}`,
      kind: OutboxEventKind.TEAM_INVITATION_CREATE,
      payload: {
        email,
        requestedBy: describePrincipal(principal),
        role: input.role,
      },
    },
    async () => {
      const invitation = await invite({
        emailAddress: email,
        expiresInDays: 7,
        publicMetadata: { role: input.role },
      });
      return { email, id: invitation.id, role: input.role };
    },
  );
  return {
    alreadyInvited: replayed,
    email: result.email,
    id: result.id,
    role: result.role,
  };
}

/** Revoke only a named invitation through the injected Clerk capability. */
export async function revokeTeamInvitation(
  principal: DomainPrincipal,
  invitationId: string,
  db: DomainDb,
  revoke: TeamInvitationRevokePort,
  idempotencyKey?: string,
): Promise<{ invitationId: string }> {
  requireAdminPrincipal(principal);
  const normalizedId = invitationId.trim();
  if (!normalizedId) {
    throw new DomainValidationError(
      "An invitation id is required.",
      "invitationId",
    );
  }
  const result = await runOutboxEffect(
    db,
    {
      key: `team-invite-revoke:${idempotencyKey?.trim() || normalizedId}`,
      kind: OutboxEventKind.TEAM_INVITATION_REVOKE,
      payload: {
        invitationId: normalizedId,
        requestedBy: describePrincipal(principal),
      },
    },
    async () => {
      await revoke(normalizedId);
      return { invitationId: normalizedId };
    },
  );
  return { invitationId: result.invitationId };
}

/**
 * Record that Clerk and the local team record disagree about someone's role.
 *
 * A role change touches two systems. The route writes Clerk first, then the
 * local row, and compensates Clerk if the local write is refused. When that
 * compensation ALSO fails, the two are left disagreeing — Clerk says one role,
 * the database says another — and the caller gets a 500 saying so. That
 * sentence used to be the only trace: nobody here watches logs, so the next
 * sign of it would be someone who cannot reach a screen they should, or worse,
 * someone who can reach one they should not.
 *
 * This leaves a durable row instead. It is deliberately not an effect anything
 * retries: which side is right is a judgement about who is meant to have that
 * role, and a machine guessing at it is how the wrong person ends up an ADMIN.
 */
export async function recordRoleReconciliation(
  db: DomainDb,
  input: {
    readonly userId: string;
    readonly clerkUserId: string;
    readonly localRole: Role;
    readonly clerkRole: Role;
    readonly reason: string;
    readonly detectedAt?: Date;
  },
): Promise<{ key: string }> {
  const detectedAt = input.detectedAt ?? new Date();
  const key = `team-role-reconciliation:${input.clerkUserId}:${detectedAt.toISOString()}`;
  await enqueueOutboxEvent(db, {
    key,
    kind: OutboxEventKind.TEAM_ROLE_RECONCILIATION,
    payload: {
      clerkRole: input.clerkRole,
      clerkUserId: input.clerkUserId,
      detectedAt: detectedAt.toISOString(),
      localRole: input.localRole,
      reason: input.reason,
      userId: input.userId,
    },
  });
  return { key };
}

/** The unresolved divergences, newest first, for an admin to work through. */
export async function listRoleReconciliations(
  principal: DomainPrincipal,
  db: DomainDb,
  limit = 50,
): Promise<
  Array<{
    key: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
    status: OutboxEventStatus;
  }>
> {
  requireAdminPrincipal(principal);
  return db.outboxEvent.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, key: true, payload: true, status: true },
    take: Math.max(1, Math.min(limit, 200)),
    where: {
      kind: OutboxEventKind.TEAM_ROLE_RECONCILIATION,
      status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] },
    },
  });
}

/** Close one divergence once a human has put the two systems back in step. */
export async function resolveRoleReconciliation(
  principal: DomainPrincipal,
  key: string,
  db: DomainDb,
  note: string,
): Promise<void> {
  requireAdminPrincipal(principal);
  const resolved = await db.outboxEvent.updateMany({
    data: {
      completedAt: new Date(),
      result: { note, resolvedBy: describePrincipal(principal) },
      status: OutboxEventStatus.SUCCEEDED,
    },
    where: {
      key,
      kind: OutboxEventKind.TEAM_ROLE_RECONCILIATION,
      status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] },
    },
  });
  if (resolved.count !== 1) {
    throw new DomainNotFoundError(
      "That reconciliation is not open; it may already have been resolved.",
    );
  }
}

/**
 * Change a member's role, refusing to demote the last ADMIN.
 *
 * Serializable, and the update is conditional on the role the decision was
 * made against — so two role changes racing cannot both pass the admin count
 * and leave nobody. With this few people that is not two administrators at
 * once; it is one person with the team page open twice, or a retry after a
 * timeout.
 *
 * Takes a client that can open a transaction, not a caller's: the count and
 * the write have to be in the same one, or the guard proves nothing.
 */
export async function changeTeamMemberRole(
  principal: DomainPrincipal,
  input: {
    userId: string;
    expectedRole: Role;
    newRole: Role;
  },
  db: TransactionalDomainDb,
): Promise<RoleChangeResult> {
  requireAdminPrincipal(principal);

  return db.$transaction(
    async (tx) => {
      const current = await tx.user.findUnique({
        select: { id: true, name: true, role: true },
        where: { id: input.userId },
      });
      if (!current) throw new DomainNotFoundError("Team member not found.");
      if (current.role !== input.expectedRole) {
        throw new DomainTransitionError(
          "The team member changed during this role update; refresh and retry.",
          current.role,
          input.newRole,
        );
      }

      if (
        current.role === Role.ADMIN &&
        input.newRole !== Role.ADMIN &&
        (await tx.user.count({ where: { role: Role.ADMIN } })) <= 1
      ) {
        throw new DomainTransitionError(
          "The last admin cannot be demoted.",
          current.role,
          input.newRole,
        );
      }

      const changed = await tx.user.updateMany({
        data: { role: input.newRole },
        where: { id: current.id, role: input.expectedRole },
      });
      if (changed.count !== 1) {
        throw new DomainTransitionError(
          "The team member changed during this role update; refresh and retry.",
          current.role,
          input.newRole,
        );
      }

      return { name: current.name, role: input.newRole, userId: current.id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
