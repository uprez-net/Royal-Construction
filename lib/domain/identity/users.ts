import { Role, type User } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  type DomainPrincipal,
  type UserPrincipal,
  userPrincipal,
} from "../principal";
import { canonicalPhone } from "../projects/owners";

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

/**
 * Create an application user, and a linked customer record when the role is
 * CUSTOMER.
 *
 * The customer row and the link are two writes that only mean anything
 * together — a CUSTOMER user with no customerId matches no project — so they
 * go in one transaction. The original did them as three separate round trips
 * and would leave a half-created account behind on a failure.
 */
export async function createUser(
  input: {
    name: string;
    email: string;
    clerkId: string;
    phone: string;
    role?: Role;
  },
  db: TransactionalDomainDb,
): Promise<{
  success: true;
  message: string;
  userId: string;
  customerId: string | null;
  role: Role;
}> {
  const role = input.role ?? Role.GUEST;

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        clerkId: input.clerkId,
        email: input.email,
        name: input.name,
        phone: input.phone,
        role,
      },
    });

    let customerId: string | null = null;
    if (role === Role.CUSTOMER) {
      const customer = await tx.customer.create({
        data: {
          email: input.email,
          name: input.name,
          // Same form the project owners are stored in, so this customer is
          // found when a contract later names them.
          phone: canonicalPhone(input.phone),
        },
      });
      await tx.user.update({
        data: { customerId: customer.id },
        where: { id: user.id },
      });
      customerId = customer.id;
    }

    return {
      customerId,
      message: "User created successfully",
      role: user.role,
      success: true as const,
      userId: user.id,
    };
  });
}

/**
 * Update an application user by Clerk id.
 *
 * Undefined fields are dropped rather than written as null — a partial update
 * from the Clerk webhook carries only what changed.
 *
 * No last-admin guard here: this is the sync path, and it applies whatever
 * Clerk says. A role change made inside the application goes through
 * ./team.ts#changeTeamMemberRole, which does guard it.
 */
export async function updateUserByClerkId(
  clerkId: string,
  updates: Partial<{ name: string; email: string; phone: string; role: Role }>,
  db: TransactionalDomainDb,
): Promise<{
  success: true;
  message: string;
  userId: string;
  role: Role;
  customerId: string | null;
}> {
  const data = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );

  return db.$transaction(async (tx) => {
    const user = await tx.user.update({ data, where: { clerkId } });

    let customerId: string | null = null;
    if (updates.role === Role.CUSTOMER && !user.customerId) {
      const customer = await tx.customer.create({
        data: {
          email: user.email,
          name: user.name,
          phone: canonicalPhone(user.phone),
        },
      });
      await tx.user.update({
        data: { customerId: customer.id },
        where: { id: user.id },
      });
      customerId = customer.id;
    } else if (updates.role === Role.CUSTOMER) {
      customerId = user.customerId;
    }

    return {
      customerId,
      message: "User updated successfully",
      role: user.role,
      success: true as const,
      userId: user.id,
    };
  });
}

export async function deleteUserByClerkId(
  clerkId: string,
  db: DomainDb,
): Promise<{ success: true; message: string }> {
  await db.user.delete({ where: { clerkId } });
  return { message: "User deleted successfully", success: true };
}

/** Every application user's Clerk id, for a broadcast notification. */
export async function listAllClerkIds(db: DomainDb): Promise<string[]> {
  const users = await db.user.findMany({ select: { clerkId: true } });
  return users.map((user) => user.clerkId);
}
