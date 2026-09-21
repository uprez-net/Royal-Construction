import { Role, type User } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  type DomainPrincipal,
  type UserPrincipal,
  userPrincipal,
} from "../principal";

// Application-user lookup and the conversion into a principal.
//
// The Node-safe half of lib/data/user.ts, which is a "use server" module —
// meaning every one of its exports is a POST endpoint callable with whatever
// arguments the sender chooses. Reads belong here, where they are callable
// from Eve, a cron and a script as well as a page, and where being exported
// does not publish an endpoint.
//
// Caching stays in the Next adapter: `cacheTag`/`cacheLife` are request-scoped
// Next concepts, and a cron or an Eve tool holding a cached user row would be
// holding a stale role.

export async function findUserByClerkId(
  clerkId: string,
  db: DomainDb,
): Promise<User | null> {
  return db.user.findUnique({ where: { clerkId } });
}

export async function findUserById(
  userId: string,
  db: DomainDb,
): Promise<User | null> {
  return db.user.findUnique({ where: { id: userId } });
}

/**
 * The principal for a signed-in Clerk account, or null.
 *
 * Null means "Clerk knows this account, the application does not" — a real
 * state during onboarding, before the Clerk webhook has created the row. The
 * caller decides whether that is a refusal or an anonymous request; it is not
 * this function's call.
 */
export async function principalForClerkId(
  clerkId: string,
  db: DomainDb,
): Promise<UserPrincipal | null> {
  const user = await findUserByClerkId(clerkId, db);
  return user ? userPrincipal(user) : null;
}

/** Every ADMIN's application id — who an approval request has to reach. */
export async function findAdminUserIds(db: DomainDb): Promise<string[]> {
  const admins = await db.user.findMany({
    select: { id: true },
    where: { role: Role.ADMIN },
  });
  return admins.map((admin) => admin.id);
}

/**
 * Clerk ids for a set of application user ids, for notification dispatch.
 *
 * Blank and duplicate ids are dropped before the query rather than sent, and
 * an empty list short-circuits: `{ in: [] }` is a query that reads every row
 * in some engines and none in others, and neither is what the caller meant.
 */
export async function resolveClerkIds(
  userIds: readonly (string | null | undefined)[],
  db: DomainDb,
): Promise<string[]> {
  const ids = [
    ...new Set(
      userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return [];

  const users = await db.user.findMany({
    select: { clerkId: true },
    where: { id: { in: ids } },
  });
  return users.map((user) => user.clerkId);
}

/**
 * How many ADMINs remain if this one stops being an ADMIN.
 *
 * The last-admin guard: two or three people share one or two logins here, so
 * demoting the only ADMIN locks the business out of its own admin surface with
 * nobody to undo it.
 */
export async function countOtherAdmins(
  excludingUserId: string,
  db: DomainDb,
): Promise<number> {
  return db.user.count({
    where: { id: { not: excludingUserId }, role: Role.ADMIN },
  });
}

/** Attribution for a history row, resolved to a real user or left unset. */
export async function attributableAuthorId(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<string | null> {
  if (principal.kind !== "user") return null;
  const user = await findUserById(principal.userId, db);
  return user?.id ?? null;
}
