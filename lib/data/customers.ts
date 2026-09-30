import "server-only";

import { cacheTag, cacheLife } from "next/cache";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  findCustomerByContact as findCustomerByContactDomain,
  findCustomerById as findCustomerByIdDomain,
  listCustomersForDropdown,
  type CustomerDropdownItem,
  type PaginatedLookupResult,
} from "@/lib/domain/identity/customers";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { CACHE_PROFILES } from "@/types/cache";

// The Next adapter over `lib/domain/identity/customers.ts`.
//
// **This module is no longer `"use server"`.** Every export was a POST
// endpoint reachable by any signed-in caller with whatever arguments they
// chose — including `findCustomerById`, which answers with a whole `Customer`
// row. Same class of surface `lib/data/user.ts` carried before phase 7 closed
// it, and the same fix: the reads live in the domain, the dropdown is
// staff-only, and what is left here is caching.

export type { CustomerDropdownItem, PaginatedLookupResult };

async function cachedCustomersForDropdown(
  principal: DomainPrincipal,
  page: number,
  limit: number,
  query?: string,
) {
  "use cache";

  cacheTag("customers");
  cacheLife(CACHE_PROFILES.MEDIUM);

  return listCustomersForDropdown(principal, { limit, page, query }, prisma);
}

export async function getCachedCustomersForDropdown(
  page = 1,
  limit = 10,
  query?: string,
) {
  return cachedCustomersForDropdown(
    await currentPrincipal(),
    page,
    limit,
    query,
  );
}

export async function getCustomersForDropdown(
  page = 1,
  limit = 10,
  query?: string,
) {
  return listCustomersForDropdown(
    await currentPrincipal(),
    { limit, page, query },
    prisma,
  );
}

export async function findCustomerById(customerId: string) {
  return findCustomerByIdDomain(customerId, prisma);
}

export async function findCustomerByContact(
  email?: string | null,
  phone?: string | null,
  tx?: Prisma.TransactionClient,
) {
  return findCustomerByContactDomain({ email, phone }, tx ?? prisma);
}
