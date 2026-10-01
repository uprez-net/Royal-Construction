import { Prisma, type Customer } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { ownerFieldPath, type ProjectOwner } from "../projects/owners";

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
 * The customers a project's owners are, in the owners' order: the customer
 * already on file where the email or phone identifies one, otherwise a new one.
 *
 * **A recurring client is linked, not refused.** Clients come back for a
 * second build, so an owner whose email (or, failing that, phone) is already
 * on file is that customer: the new project is linked to the existing id.
 * Email is looked up first, because it is the authoritative identity
 * (`findCustomerByContact` uses the same order).
 *
 * **What the contract updates on a linked customer.** The contract is the
 * latest word on the client, so the name's spelling and the address are
 * written from it, and so is an email or phone that changed — but only when
 * no other customer holds that value. A phone that is on file for somebody
 * else (a spouse's, a shared household line) is left alone rather than moved:
 * the client keeps the number they had, and the other customer keeps theirs.
 * An owner with no phone is matched on email alone, is created with a NULL
 * phone, and never clears a phone a linked customer already has.
 *
 * **Refused only where linking would put the wrong person on the project:**
 *
 *   - the matching customer has a different name. Households share a phone or
 *     an email, and linking John's contract to Jane's record would name Jane
 *     on John's project and its invoices — and renaming the record would
 *     rewrite Jane's earlier projects. The office can tell which it is; this
 *     cannot.
 *   - the matching customer is already a different owner of this project. One
 *     customer cannot be two owners (`ProjectCustomer` is keyed on both).
 *
 * A refusal message never carries the other record's details.
 *
 * Deliberately says nothing about caches: this runs inside the project
 * transaction, and an invalidation fired before commit lets another request
 * refill the "customers" cache from uncommitted data.
 *
 * @throws {DomainValidationError} One of the refusals above, naming the
 * owner's row under `legalAdministrationOwners` (see `ownerFieldPath`).
 */
export async function resolveCustomersForProject(
  owners: readonly ProjectOwner[],
  db: DomainDb,
): Promise<ResolvedProjectCustomer[]> {
  const claimedBy = new Map<string, string>();
  const resolved: ResolvedProjectCustomer[] = [];

  for (const [index, owner] of owners.entries()) {
    const result = await resolveOwnerCustomer(owner, index, claimedBy, db);
    claimedBy.set(result.customer.id, `Owner ${index + 1} (${owner.name})`);
    resolved.push(result);
  }

  return resolved;
}

function nameWords(name: string): string[] {
  return name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Whether a customer on file and an owner on the contract are plausibly one
 * person: every word of the shorter name appears in the longer. "Jane" (a
 * customer made from an enquiry) is "Jane Smith"; "Jane Smith" is
 * "JANE A. SMITH"; "Jane Smith" is not "John Smith".
 */
function sameName(onFile: string, onContract: string): boolean {
  const a = nameWords(onFile);
  const b = nameWords(onContract);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const words = new Set(longer);
  return shorter.every((word) => words.has(word));
}

async function resolveOwnerCustomer(
  owner: ProjectOwner,
  index: number,
  claimedBy: ReadonlyMap<string, string>,
  db: DomainDb,
): Promise<ResolvedProjectCustomer> {
  const { address, email, name, phone } = owner;
  const label = `Owner ${index + 1} (${name})`;

  const byEmail = await db.customer.findFirst({
    where: { email: { equals: email, mode: Prisma.QueryMode.insensitive } },
  });
  // No phone is no lookup: `findUnique({ phone: "" })` would match nobody,
  // and a missing phone is NULL on the customer, never "".
  const byPhone = phone
    ? await db.customer.findUnique({ where: { phone } })
    : null;

  const existing = byEmail ?? byPhone;
  if (!existing) {
    const customer = await db.customer.create({
      data: { address, email, name, phone: phone || null },
    });
    return { changed: true, created: true, customer };
  }

  const matchedOn = byEmail ? "email" : "phone";

  const earlierOwner = claimedBy.get(existing.id);
  if (earlierOwner !== undefined) {
    throw new DomainValidationError(
      `${label} and ${earlierOwner} match the same customer on file. Check their emails and phone numbers against the contract.`,
      ownerFieldPath(index, matchedOn),
    );
  }

  if (!sameName(existing.name, name)) {
    const detail = matchedOn === "email" ? "email" : "phone number";
    throw new DomainValidationError(
      `${label}: this ${detail} is already on file for a customer with a different name. If it is the same person, change the name to match the customer on file; if not, use ${name}'s own ${detail}.`,
      ownerFieldPath(index, matchedOn),
    );
  }

  const patch: Prisma.CustomerUpdateInput = {};
  if (name !== existing.name) patch.name = name;
  if (address !== existing.address) patch.address = address;
  // An email or phone is moved onto this customer only when nobody else holds
  // it: `byEmail`/`byPhone` is that holder, and both columns are unique.
  if (email !== existing.email.toLowerCase() && !byEmail) patch.email = email;
  // A contract with no phone never clears the one on file.
  if (phone && phone !== existing.phone && !byPhone) patch.phone = phone;

  if (Object.keys(patch).length === 0) {
    return { changed: false, created: false, customer: existing };
  }
  const updated = await db.customer.update({
    where: { id: existing.id },
    data: patch,
  });
  return { changed: true, created: false, customer: updated };
}
