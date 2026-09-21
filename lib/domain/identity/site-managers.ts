import { Prisma, Role, type User } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";

// Who can be assigned to a project as its site manager.
//
// Moved from `lib/data/siteManagers.ts`, which was `"use server"`: every
// export was a POST endpoint, and `getSiteManagerById` answered with the whole
// `User` row — email, phone, Clerk id — to any signed-in caller, including a
// customer-portal account. Same class as `lib/data/user.ts` before phase 7.
// The reads are staff-only here, and the one a command needs returns only the
// fields a project assignment uses.

export type SiteManagerDropdownItem = Pick<
  User,
  "id" | "name" | "email" | "phone" | "createdAt" | "role"
>;

export type PaginatedLookupResult<T> = {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const defaultPageSize = 10;

/**
 * Staff who may hold a project.
 *
 * Everyone except GUEST and CUSTOMER, which is the rule as written — not
 * `INTERNAL_ROLES`, which includes GUEST because that is how lead access has
 * always been scoped. The two lists differ on purpose: a GUEST may see leads
 * and may not be handed a build.
 */
const ASSIGNABLE_ROLE_FILTER: Prisma.UserWhereInput = {
  role: { not: { in: [Role.GUEST, Role.CUSTOMER] } },
};

export async function listSiteManagersForDropdown(
  principal: DomainPrincipal,
  input: { page?: number; limit?: number; query?: string },
  db: DomainDb,
): Promise<PaginatedLookupResult<SiteManagerDropdownItem>> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Only staff can browse the site-manager list.",
    );
  }

  const page =
    Number.isFinite(input.page ?? 1) && (input.page ?? 1) > 0
      ? Math.floor(input.page ?? 1)
      : 1;
  const limit =
    Number.isFinite(input.limit ?? defaultPageSize)
    && (input.limit ?? defaultPageSize) > 0
      ? Math.min(Math.floor(input.limit ?? defaultPageSize), 50)
      : defaultPageSize;
  const search = input.query?.trim() ?? "";

  const where: Prisma.UserWhereInput = {
    ...ASSIGNABLE_ROLE_FILTER,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };

  const [items, totalCount] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        role: true,
      },
    }),
    db.user.count({ where }),
  ]);

  return {
    items,
    page,
    limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  };
}

export type AssignableSiteManager = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
};

/** The site manager this id names, or null when it names nobody assignable. */
export async function findAssignableSiteManager(
  siteManagerId: string,
  db: DomainDb,
): Promise<AssignableSiteManager | null> {
  return db.user.findFirst({
    where: { id: siteManagerId, ...ASSIGNABLE_ROLE_FILTER },
    select: { id: true, name: true, email: true, role: true },
  });
}

/**
 * Assert a site manager id names somebody who may hold a project.
 *
 * `DomainNotFoundError`, not an authorization refusal: the caller is allowed
 * to assign, the id simply does not name an assignable person — which is also
 * the answer when it names a customer, because whether a given id belongs to a
 * customer account is not something a project form needs to learn.
 */
export async function requireAssignableSiteManager(
  siteManagerId: string,
  db: DomainDb,
): Promise<AssignableSiteManager> {
  const siteManager = await findAssignableSiteManager(siteManagerId, db);
  if (!siteManager) {
    throw new DomainNotFoundError(
      "That site manager could not be found. Pick a different one.",
    );
  }
  return siteManager;
}
