import { Prisma, type Customer } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";

// The customer record a project belongs to: finding one, and resolving the
// one a new project should use.
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
    const byPhone = await db.customer.findUnique({ where: { phone } });
    if (byPhone) return byPhone;
  }
  return null;
}

export type ResolveCustomerInput = {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly address?: string | null;
};

/**
 * The customer a project should be attached to: the existing record if the
 * contact details already identify one, otherwise a new one.
 *
 * Email and phone are resolved INDEPENDENTLY. The helper this replaced
 * returned the email match and never looked at the phone, so a conflict —
 * email and phone belonging to DIFFERENT customers — silently attached the
 * project to the email record with nobody noticing. Here the conflict is
 * explicit: email is the authoritative identity and wins deterministically,
 * the phone record's contact fields are never stolen, and changed values are
 * refreshed only when no OTHER customer already holds them, so the unique
 * constraint is never tripped and no record is hijacked.
 *
 * Every persisted value is the NORMALISED one — the same trimmed locals the
 * lookups use. Storing the raw input meant a record created from " a@b.com "
 * never matched the trimmed lookup again, so the next call created a duplicate
 * instead of reusing it.
 *
 * Returns `{ customer, created }` so the caller can decide what to invalidate.
 * Deliberately says nothing about caches: when this runs inside a transaction
 * the write has not committed, and firing an invalidation here let another
 * request refill the "customers" cache from pre-commit data with nothing to
 * correct it afterwards.
 */
export async function resolveCustomerForProject(
  input: ResolveCustomerInput,
  db: DomainDb,
): Promise<{ customer: Customer; created: boolean; changed: boolean }> {
  const address = input.address?.trim() || null;
  const name = input.name?.trim();
  const email = input.email?.trim();
  const phone = input.phone?.trim();

  const byEmail = email
    ? await db.customer.findUnique({ where: { email } })
    : null;
  const byPhone = phone
    ? await db.customer.findUnique({ where: { phone } })
    : null;
  const existing = byEmail ?? byPhone;

  if (existing) {
    const patch: Prisma.CustomerUpdateInput = {};
    if (name && name !== existing.name) patch.name = name;
    if (address && address !== existing.address) patch.address = address;
    if (
      email
      && email !== existing.email
      && (byEmail === null || byEmail.id === existing.id)
    ) {
      patch.email = email;
    }
    if (
      phone
      && phone !== existing.phone
      && (byPhone === null || byPhone.id === existing.id)
    ) {
      patch.phone = phone;
    }

    if (Object.keys(patch).length === 0) {
      return { changed: false, created: false, customer: existing };
    }
    const updated = await db.customer.update({
      where: { id: existing.id },
      data: patch,
    });
    return { changed: true, created: false, customer: updated };
  }

  const customer = await db.customer.create({
    data: { name, email, phone, address },
  });
  return { changed: true, created: true, customer };
}
