import "server-only";

import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { Role } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";

import {
  createUser as createUserDomain,
  deleteUserByClerkId,
  findAdminUserIds,
  findUserByClerkId,
  listOfficeNotificationRecipients,
  resolveNotificationRecipients,
  updateUserByClerkId,
} from "@/lib/domain/identity/users";

// Deliberately NOT "use server" any more.
//
// In a "use server" module every exported async function is its own Server
// Action: a POST endpoint that runs with whatever arguments the sender
// chooses, whether or not a screen calls it
// (node_modules/next/dist/docs/01-app/02-guides/data-security.md). That made
// `updateUser(clerkId, { role: "ADMIN" })` reachable by any signed-in caller
// — a privilege escalation with no guard in front of it. It was on
// tests/security/use-server-auth.test.ts's allowlist as a known follow-up.
//
// Nothing here was ever called from a client component: every importer is a
// page, a route handler, proxy.ts or another server module. Dropping the
// directive closes the endpoint surface and changes nothing else.
//
// The middleware lookup lives in the Node-safe domain module now, so this
// adapter can be marked server-only without pulling the marker into proxy.ts.
//
// The reads and writes themselves live in lib/domain/identity/users.ts, where
// Eve, a cron and a script can reach them too. Only the cached read below
// needs Next.

/**
 * Creates a new application user, and a linked customer record when the role
 * is CUSTOMER.
 */
export async function createUser(
  name: string,
  email: string,
  clerkId: string,
  phone: string,
  role: Role = Role.GUEST,
) {
  return createUserDomain({ clerkId, email, name, phone, role }, prisma);
}

/** Retrieves a user by their Clerk identifier, or null. */
export async function getUserByClerkId(clerkId: string) {
  return findUserByClerkId(clerkId, prisma);
}

/**
 * Updates an existing application user.
 *
 * No last-admin guard, deliberately: the only caller is the Clerk webhook,
 * which syncs whatever Clerk says. A role change made in the app goes through
 * lib/domain/identity/team.ts#changeTeamMemberRole, which does guard it.
 * Routing the webhook through that guard would leave Clerk and the
 * application disagreeing whenever it refused, so that needs a decision rather
 * than a quiet change (issue #301, phase 6).
 */
export async function updateUser(
  clerkId: string,
  updates: Partial<{ name: string; email: string; phone: string; role: Role }>,
) {
  return updateUserByClerkId(clerkId, updates, prisma);
}

/** Deletes a user by their Clerk identifier. */
export async function deleteUser(clerkId: string) {
  return deleteUserByClerkId(clerkId, prisma);
}

/**
 * Retrieves a cached user by their Clerk identifier.
 *
 * Tagged with the user's Clerk ID so a profile update can invalidate just this
 * one. The only export here that genuinely needs Next.
 */
export async function getUserByClerkIdCached(clerkId: string) {
  "use cache";
  cacheTag(`user-${clerkId}`);
  cacheLife(CACHE_PROFILES.MEDIUM);

  return findUserByClerkId(clerkId, prisma);
}

/** Clerk id and email of everyone in the office, for a broadcast notification. */
export async function getOfficeNotificationRecipients() {
  return listOfficeNotificationRecipients(prisma);
}

/** Clerk id and email for internal user ids, for Novu dispatch. */
export async function getNotificationRecipients(
  userIds: Array<string | null | undefined>,
) {
  return resolveNotificationRecipients(userIds, prisma);
}

/** Every ADMIN's application id — who an approval request has to reach. */
export async function getAllAdminUsersIds(): Promise<string[]> {
  return findAdminUserIds(prisma);
}
