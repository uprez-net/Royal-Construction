import {
  OutboxEventKind,
  OutboxEventStatus,
  Prisma,
  Role,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import {
  describePrincipal,
  isOfficeRole,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import {
  enqueueOutboxEvent,
  runOutboxEffect,
  runOutboxEffectWithOutcome,
} from "../outbox";
import {
  recordTeamInvitation,
  revokeRecordedTeamInvitation,
} from "./invitations";
import { findUserByClerkId } from "./users";

/** How long a Clerk team invitation stays usable. */
const INVITATION_EXPIRY_DAYS = 7;

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
        expiresInDays: INVITATION_EXPIRY_DAYS,
        publicMetadata: { role: input.role },
      });
      return { email, id: invitation.id, role: input.role };
    },
  );
  // Kept so the role still reaches someone who signs up without the link
  // (./invitations.ts). The invitation has gone either way, so a failure here
  // is logged rather than reported as a failed send: Clerk's own copy of the
  // role still covers a sign-up through the link.
  try {
    await recordTeamInvitation(
      {
        clerkInvitationId: result.id,
        email: result.email,
        expiresAt: new Date(
          (input.now ?? new Date()).getTime()
            + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
        role: result.role,
      },
      db,
    );
  } catch (error) {
    console.error(
      `[team-invite] Invitation ${result.id} was sent but its role could not be recorded`,
      error,
    );
  }
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
  // Clerk has revoked it; this only stops our copy granting the role. Logged
  // rather than thrown for the same reason as the invite above.
  try {
    await revokeRecordedTeamInvitation(result.invitationId, db);
  } catch (error) {
    console.error(
      `[team-invite] Invitation ${result.invitationId} was revoked but our record of it was not`,
      error,
    );
  }
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
 * The two rules a role change must pass, read without writing: the last admin
 * stays, and someone leaving the office hands their leads over first.
 */
async function assertRoleChangeAllowed(
  current: { id: string; name: string | null; role: Role },
  newRole: Role,
  db: DomainDb,
): Promise<void> {
  if (
    current.role === Role.ADMIN
    && newRole !== Role.ADMIN
    && (await db.user.count({ where: { role: Role.ADMIN } })) <= 1
  ) {
    throw new DomainTransitionError(
      "The last admin cannot be demoted.",
      current.role,
      newRole,
    );
  }

  // Whoever holds a lead can open it (`canAccessLead`), and the follow-up
  // and meeting reminders email its holder the client's details. Leads are
  // the office's (`assertOfficeAssignee`), so someone leaving the office —
  // to site manager most often — hands theirs over first. Refused rather
  // than reassigned here: who takes them is the office's call.
  if (isOfficeRole(current.role) && !isOfficeRole(newRole)) {
    const [leads, tasks] = await Promise.all([
      db.lead.count({ where: { assignedId: current.id } }),
      db.leadTask.count({
        where: { assignedId: current.id, completedAt: null },
      }),
    ]);
    if (leads > 0 || tasks > 0) {
      const held = [
        leads > 0 ? `${leads} lead${leads === 1 ? "" : "s"}` : null,
        tasks > 0 ? `${tasks} open lead task${tasks === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      throw new DomainTransitionError(
        `${current.name || "This team member"} still has ${held} assigned. Reassign them to someone in the office first, then change the role.`,
        current.role,
        newRole,
      );
    }
  }
}

/**
 * The same checks as `changeTeamMemberRole`, with nothing written. For the
 * team route, which publishes the role to Clerk before the local write: a
 * change these rules refuse must never reach Clerk, because Clerk's
 * `user.updated` webhook writes the role straight back to the database.
 */
export async function checkTeamMemberRoleChange(
  principal: DomainPrincipal,
  input: { userId: string; newRole: Role },
  db: DomainDb,
): Promise<void> {
  requireAdminPrincipal(principal);
  const current = await db.user.findUnique({
    select: { id: true, name: true, role: true },
    where: { id: input.userId },
  });
  if (!current) throw new DomainNotFoundError("Team member not found.");
  await assertRoleChangeAllowed(current, input.newRole, db);
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

      await assertRoleChangeAllowed(current, input.newRole, tx);

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

export type TeamMemberProfileInput = {
  /** Clerk's id — the team screen lists Clerk users, not application rows. */
  readonly clerkUserId: string;
  readonly name: string;
  readonly phone: string;
};

export type TeamMemberProfile = {
  readonly userId: string;
  readonly clerkUserId: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
};

/**
 * Writes the name to Clerk and the phone to Clerk's `publicMetadata.phone`.
 * Throws with Clerk's own message.
 *
 * Metadata, not a Clerk phone number: those carry verification, uniqueness
 * and instance-setting rules that have nothing to do with a contact number
 * the office reads on screen. The database is the record; the metadata copy
 * is what the `user.updated` webhook carries back across.
 */
export type TeamProfilePort = (input: {
  clerkUserId: string;
  firstName: string;
  lastName: string;
  phone: string;
}) => Promise<void>;

/**
 * The one stored form of a team phone, E.164, in the database and in Clerk's
 * metadata alike so the two never disagree on spacing. The screen shows it in
 * AU format (`utils/phone.ts#formatAuPhone`).
 *
 * An Australian local mobile or landline ("0412 345 678") is read as +61,
 * because that is what everyone here will type. Anything else must already
 * carry its country code: guessing one is how a number ends up pointing at
 * somebody else.
 */
export function teamPhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  // Separators only. Stripping every non-digit would fold an extension
  // ("+61 2 4660 0655 ext 12") into the number and text somebody else.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (/^0\d{9}$/.test(digits)) return `+61${digits.slice(1)}`;
  return null;
}

export type TeamMemberRow = {
  readonly id: string;
  readonly clerkId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly role: Role;
};

/**
 * The people on the team screen: application users, not Clerk's whole user
 * list.
 *
 * The Clerk instance holds accounts the app has no record of: sign-ups the
 * webhook never reached, and accounts from another deployment sharing the same
 * instance. Listing those offered role and profile edits that fail on the
 * missing row. The database is the record, so it decides who is listed;
 * search matches name, email or phone.
 */
export async function listTeamMembers(
  principal: DomainPrincipal,
  input: { readonly q: string; readonly page: number; readonly limit: number },
  db: DomainDb,
): Promise<{ members: TeamMemberRow[]; total: number }> {
  requireAdminPrincipal(principal);
  const q = input.q.trim();
  // A whole number typed as the office writes it ("0412 345 678") is found in
  // its stored form too; a fragment still matches as a substring.
  const fullPhone = q ? teamPhoneE164(q) : null;
  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q.replace(/\s+/g, "") } },
          ...(fullPhone ? [{ phone: fullPhone }] : []),
        ],
      }
    : {};
  const [members, total] = await Promise.all([
    db.user.findMany({
      orderBy: [{ name: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        clerkId: true,
        email: true,
        id: true,
        name: true,
        phone: true,
        role: true,
      },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      where,
    }),
    db.user.count({ where }),
  ]);
  return { members, total };
}

/** The phone in its stored form, or a refusal saying what a number looks like. */
function requireTeamPhone(raw: string): string {
  const phone = teamPhoneE164(raw);
  if (!phone) {
    throw new DomainValidationError(
      "Enter a phone number like 0412 345 678, or with its country code like +61 412 345 678.",
      "phone",
    );
  }
  return phone;
}

/**
 * A phone `userId` may hold: in its stored form, and nobody else's.
 *
 * `User.phone` is unique, so a number already on another account would fail
 * the write anyway — checking first means the commonest refusal touches
 * nothing (no Clerk write to undo). The team screen and a person editing their
 * own profile both go through this, so the two never accept different numbers.
 */
export async function requireAvailableTeamPhone(
  raw: string,
  userId: string,
  db: DomainDb,
): Promise<string> {
  const phone = requireTeamPhone(raw);
  const taken = await db.user.findFirst({
    select: { id: true },
    where: { id: { not: userId }, phone },
  });
  if (taken) {
    throw new DomainValidationError(
      "That phone number already belongs to another team member.",
      "phone",
    );
  }
  return phone;
}

/**
 * Change a team member's name and phone, in Clerk and in the local record.
 *
 * The email is deliberately not editable: it is the sign-in identity, and
 * changing it is Clerk's verification flow, not a form field.
 *
 * Order matters. The local uniqueness check runs first so the commonest
 * refusal — the number already belongs to someone — touches nothing. Clerk is
 * written next, and only then the local row, so a Clerk refusal leaves both
 * sides as they were and the operator reads Clerk's reason. If the local
 * write then fails, Clerk is put back to what the database — the record —
 * still holds, and the local error surfaces. Leaving Clerk ahead would not
 * converge on its own: a number lost to the unique constraint would fail the
 * webhook's copy the same way.
 */
export async function updateTeamMemberProfile(
  principal: DomainPrincipal,
  input: TeamMemberProfileInput,
  db: DomainDb,
  updateIdentity: TeamProfilePort,
): Promise<TeamMemberProfile> {
  requireAdminPrincipal(principal);

  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) {
    throw new DomainValidationError("A name is required.", "name");
  }
  if (name.length > 100) {
    throw new DomainValidationError(
      "That name is too long — keep it under 100 characters.",
      "name",
    );
  }
  requireTeamPhone(input.phone);

  const user = await findUserByClerkId(input.clerkUserId, db);
  if (!user) throw new DomainNotFoundError("Team member not found.");

  const phone = await requireAvailableTeamPhone(input.phone, user.id, db);

  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");

  try {
    await updateIdentity({
      clerkUserId: user.clerkId,
      firstName,
      lastName,
      phone,
    });
  } catch (error) {
    throw new DomainSideEffectError(
      error instanceof Error && error.message
        ? `Clerk refused the change: ${error.message}`
        : "Clerk refused the change; nothing was saved.",
      "clerk",
      false,
      { cause: error },
    );
  }

  try {
    await db.user.update({ data: { name, phone }, where: { id: user.id } });
  } catch (error) {
    const [previousFirstName = "", ...previousRest] = user.name.split(" ");
    await updateIdentity({
      clerkUserId: user.clerkId,
      firstName: previousFirstName,
      lastName: previousRest.join(" "),
      phone: user.phone,
    }).catch((compensationError) => {
      // Nothing more can be done from here; the operator still gets the
      // local error below, and the next save from the team screen rewrites
      // both sides.
      console.error(
        "[team] Could not restore Clerk after the local profile write failed",
        compensationError,
      );
    });
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new DomainValidationError(
        "That phone number already belongs to another team member.",
        "phone",
      );
    }
    throw error;
  }

  return {
    clerkUserId: user.clerkId,
    firstName,
    lastName,
    name,
    phone,
    userId: user.id,
  };
}
