import { Prisma, Role } from "@prisma/client";

import type { TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";

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

/** Invite through an injected Clerk capability after one shared admin check. */
export async function inviteTeamMember(
  principal: DomainPrincipal,
  input: TeamInvitationInput,
  invite: TeamInvitationPort,
): Promise<TeamInvitation> {
  requireAdminPrincipal(principal);
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new DomainValidationError(
      "A valid invitation email is required.",
      "email",
    );
  }
  const invitation = await invite({
    emailAddress: email,
    expiresInDays: 7,
    publicMetadata: { role: input.role },
  });
  return { email, id: invitation.id, role: input.role };
}

/** Revoke only a named invitation through the injected Clerk capability. */
export async function revokeTeamInvitation(
  principal: DomainPrincipal,
  invitationId: string,
  revoke: TeamInvitationRevokePort,
): Promise<{ invitationId: string }> {
  requireAdminPrincipal(principal);
  const normalizedId = invitationId.trim();
  if (!normalizedId) {
    throw new DomainValidationError(
      "An invitation id is required.",
      "invitationId",
    );
  }
  await revoke(normalizedId);
  return { invitationId: normalizedId };
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
