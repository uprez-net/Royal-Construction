import { Role } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { updateUserByClerkId } from "./users";

// The role a team invitation carries, from the moment the office sends it to
// the moment the account exists.
//
// Invited people kept arriving as GUEST. Clerk copies an invitation's public
// metadata onto the account it creates, but the `user.created` webhook never
// read it: it created every account as GUEST and then wrote GUEST back into
// Clerk's metadata, overwriting the role the invitation had just copied there.
// Someone who signed up without the invitation link (straight to the sign-up
// page, with the same address) had no metadata to read at all.
//
// So the role is kept in two places and read in order: Clerk's copy on the new
// account, then our own TeamInvitation row for that address.

/** A role written into Clerk metadata, or null when there is none we know. */
export function roleFromMetadata(metadata: unknown): Role | null {
  const role = (metadata as { role?: unknown } | null | undefined)?.role;
  return typeof role === "string"
    && (Object.values(Role) as string[]).includes(role)
    ? (role as Role)
    : null;
}

/**
 * Keep the role an invitation was sent with.
 *
 * Upserted on Clerk's invitation id, because the same invitation is recorded
 * by the command that sent it and again by Clerk's `invitation.created`
 * webhook, in either order. A second sighting changes nothing.
 */
export async function recordTeamInvitation(
  input: {
    readonly clerkInvitationId: string;
    readonly email: string;
    readonly role: Role;
    readonly expiresAt: Date;
  },
  db: DomainDb,
): Promise<void> {
  await db.teamInvitation.upsert({
    create: {
      clerkInvitationId: input.clerkInvitationId,
      email: input.email.trim().toLowerCase(),
      expiresAt: input.expiresAt,
      role: input.role,
    },
    update: {},
    where: { clerkInvitationId: input.clerkInvitationId },
  });
}

/** A revoked invitation stops granting its role. */
export async function revokeRecordedTeamInvitation(
  clerkInvitationId: string,
  db: DomainDb,
  now: Date = new Date(),
): Promise<void> {
  await db.teamInvitation.updateMany({
    data: { revokedAt: now },
    where: { clerkInvitationId, revokedAt: null },
  });
}

/**
 * The role a brand-new account starts with.
 *
 * Clerk's metadata first: it was copied from the invitation the person
 * actually used. Then the newest live invitation for the address: not revoked
 * and not expired. Then GUEST, as before, for a sign-up nobody invited.
 *
 * An accepted invitation still counts while it is live, because Clerk can
 * deliver `invitation.accepted` before `user.created`.
 */
export async function roleForNewAccount(
  input: {
    readonly email: string | null | undefined;
    readonly metadata: unknown;
    readonly now?: Date;
  },
  db: DomainDb,
): Promise<{ role: Role; invitationId: string | null }> {
  const fromMetadata = roleFromMetadata(input.metadata);
  if (fromMetadata) return { invitationId: null, role: fromMetadata };

  const email = input.email?.trim().toLowerCase();
  if (!email) return { invitationId: null, role: Role.GUEST };

  const invitation = await db.teamInvitation.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true },
    where: {
      email,
      expiresAt: { gt: input.now ?? new Date() },
      revokedAt: null,
    },
  });
  return invitation
    ? { invitationId: invitation.id, role: invitation.role }
    : { invitationId: null, role: Role.GUEST };
}

/** The invitation a new account was given its role from has been used. */
export async function markTeamInvitationUsed(
  invitationId: string,
  db: DomainDb,
  now: Date = new Date(),
): Promise<void> {
  await db.teamInvitation.updateMany({
    data: { acceptedAt: now },
    where: { acceptedAt: null, id: invitationId },
  });
}

/**
 * Clerk says an invitation was accepted: give its account the invited role.
 *
 * Only an account that is still GUEST is changed. GUEST is what the webhook
 * defaulted to, so an account that already holds a role either got it from
 * this invitation or had it set by an admin since; overwriting that from a
 * late or repeated event would undo a decision somebody made.
 *
 * Returns the account changed, so the caller can write the role back to Clerk,
 * or null when nothing changed. Nothing changes when the account does not
 * exist yet: `user.created` reads the same invitation when it arrives.
 */
export async function acceptTeamInvitation(
  input: {
    readonly clerkInvitationId: string;
    readonly email: string;
    readonly metadata: unknown;
    readonly now?: Date;
  },
  db: TransactionalDomainDb,
): Promise<{ clerkId: string; role: Role } | null> {
  const now = input.now ?? new Date();
  const recorded = await db.teamInvitation.findUnique({
    select: { id: true, revokedAt: true, role: true },
    where: { clerkInvitationId: input.clerkInvitationId },
  });
  if (recorded && !recorded.revokedAt) {
    await markTeamInvitationUsed(recorded.id, db, now);
  }

  const role =
    roleFromMetadata(input.metadata)
    ?? (recorded && !recorded.revokedAt ? recorded.role : null);
  const email = input.email.trim().toLowerCase();
  if (!role || role === Role.GUEST || !email) return null;

  const user = await db.user.findFirst({
    select: { clerkId: true, role: true },
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!user || user.role !== Role.GUEST) return null;

  await updateUserByClerkId(user.clerkId, { role }, db);
  return { clerkId: user.clerkId, role };
}
