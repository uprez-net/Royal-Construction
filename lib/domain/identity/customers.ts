import { Prisma, type Customer } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { PROJECT_OWNERS_FIELD, type ProjectOwner } from "../projects/owners";

// The customer records a project belongs to: finding one, and resolving the
// ones a new project's owners are.
//
// Moved from `lib/data/customers.ts`, which was `"use server"` — so every one
// of these was a POST endpoint reachable by any signed-in caller, including
// `findCustomerById`, which answers with the whole `Customer` row. That is the
// same surface `lib/data/user.ts` had before phase 7 closed it. The dropdown
// read is staff-only now; the resolution helpers take their database
// explicitly and are reachable only from a command that has already
// authorized.

export type CustomerDropdownItem = Pick<
  Customer,
  "id" | "name" | "email" | "phone" | "createdAt"
>;

export type PaginatedLookupResult<T> = {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
};

const defaultPageSize = 10;

/** The customer picker on the project wizard. Staff only — it lists everyone. */
export async function listCustomersForDropdown(
  principal: DomainPrincipal,
  input: { page?: number; limit?: number; query?: string },
  db: DomainDb,
): Promise<PaginatedLookupResult<CustomerDropdownItem>> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Only staff can browse the customer list.",
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

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : undefined;

  const [items, totalCount] = await Promise.all([
    db.customer.findMany({
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
      },
    }),
    db.customer.count({ where }),
  ]);

  return {
    items,
    page,
    limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
  };
}

export async function findCustomerById(
  customerId: string,
  db: DomainDb,
): Promise<Customer | null> {
  return db.customer.findUnique({ where: { id: customerId } });
}

export async function requireCustomerById(
  customerId: string,
  db: DomainDb,
): Promise<Customer> {
  const customer = await findCustomerById(customerId, db);
  if (!customer) throw new DomainNotFoundError("Customer not found.");
  return customer;
}

/** Email first, then phone. Email is the authoritative identity. */
export async function findCustomerByContact(
  contact: { email?: string | null; phone?: string | null },
  db: DomainDb,
): Promise<Customer | null> {
  const email = contact.email?.trim();
  const phone = contact.phone?.trim();

  if (email) {
    const byEmail = await db.customer.findUnique({ where: { email } });
    if (byEmail) return byEmail;
  }
  if (phone) {
    // `phone` is already in `canonicalPhone` form (the owner rule put it there),
    // and so is every stored `Customer.phone`, so an exact match is the same
    // number however either side was typed.
    const byPhone = await db.customer.findUnique({ where: { phone } });
    if (byPhone) return byPhone;
  }
  return null;
}

/** One resolved owner: the customer row, and what this call did to it. */
export type ResolvedProjectCustomer = {
  readonly customer: Customer;
  readonly created: boolean;
  readonly changed: boolean;
};

/**
 * The customers a project's owners are, in the owners' order: an existing
 * record where the email or phone already identifies one, otherwise a new one.
 *
 * **An existing customer is patched to match the owner.** The owner rule
 * guarantees name, email, phone and address are all present, so each is
 * written where it differs — the contract is the latest word on who the
 * customer is and how to reach them. Nothing is ever cleared, because nothing
 * the owner carries is empty. Email matching ignores case; values are stored
 * lower-cased.
 *
 * **Every ambiguity is refused, not resolved by guessing.** The helper this
 * replaced let the email record win when the email and the phone belonged to
 * different customers, and quietly dropped the phone — so the customer ended
 * up with a number that was not the owner's. Here that is a refusal naming
 * the owner, because the office can tell which is right and this cannot:
 *
 *   - the email is on file for one customer and the phone for another;
 *   - the only matching customer is already a different owner of this
 *     project. `requireProjectOwners` refuses two owners sharing a detail and
 *     each patch runs before the next lookup, so this should not be reachable;
 *     it is checked because the alternative is two owners on one customer and
 *     a primary-key collision on `ProjectCustomer` reported as something else.
 *
 * A refusal message never carries the other record's details.
 *
 * Deliberately says nothing about caches: this runs inside the project
 * transaction, and an invalidation fired before commit lets another request
 * refill the "customers" cache from uncommitted data.
 *
 * @throws {DomainValidationError} One of the ambiguities above, naming the
 * `legalAdministrationOwners` field.
 */
export async function resolveCustomersForProject(
  owners: readonly ProjectOwner[],
  db: DomainDb,
): Promise<ResolvedProjectCustomer[]> {
  const claimedBy = new Map<string, string>();
  const resolved: ResolvedProjectCustomer[] = [];

  for (const owner of owners) {
    const result = await resolveOwnerCustomer(owner, claimedBy, db);
    claimedBy.set(result.customer.id, owner.name);
    resolved.push(result);
  }

  return resolved;
}

async function resolveOwnerCustomer(
  owner: ProjectOwner,
  claimedBy: ReadonlyMap<string, string>,
  db: DomainDb,
): Promise<ResolvedProjectCustomer> {
  const { address, email, name, phone } = owner;

  const byEmail = await db.customer.findFirst({
    where: { email: { equals: email, mode: Prisma.QueryMode.insensitive } },
  });
  const byPhone = await db.customer.findUnique({ where: { phone } });

  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw new DomainValidationError(
      `${name}'s email is on file for one customer and their phone number for a different one. Check both against the contract before creating the project.`,
      PROJECT_OWNERS_FIELD,
    );
  }

  const existing = byEmail ?? byPhone;
  if (!existing) {
    const customer = await db.customer.create({
      data: { address, email, name, phone },
    });
    return { changed: true, created: true, customer };
  }

  const earlierOwner = claimedBy.get(existing.id);
  if (earlierOwner !== undefined) {
    throw new DomainValidationError(
      `${name} and ${earlierOwner} match the same customer on file. Check their emails and phone numbers against the contract.`,
      PROJECT_OWNERS_FIELD,
    );
  }

  const patch: Prisma.CustomerUpdateInput = {};
  if (name !== existing.name) patch.name = name;
  if (email !== existing.email.toLowerCase()) patch.email = email;
  if (phone !== existing.phone) patch.phone = phone;
  if (address !== existing.address) patch.address = address;

  if (Object.keys(patch).length === 0) {
    return { changed: false, created: false, customer: existing };
  }
  const updated = await db.customer.update({
    where: { id: existing.id },
    data: patch,
  });
  return { changed: true, created: false, customer: updated };
}
