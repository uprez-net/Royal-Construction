import "server-only";

import { cacheTag, cacheLife } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  findAssignableSiteManager,
  listSiteManagersForDropdown,
  type PaginatedLookupResult,
  type SiteManagerDropdownItem,
} from "@/lib/domain/identity/site-managers";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { CACHE_PROFILES } from "@/types/cache";

// The Next adapter over `lib/domain/identity/site-managers.ts`.
//
// **This module is no longer `"use server"`.** `getSiteManagerById` was an
// exported Server Action returning a whole `User` row — email, phone, Clerk id
// — to any signed-in caller who posted an id at it, including a
// customer-portal account. The lookup is a domain read now and returns only
// what a project assignment needs.

export type { PaginatedLookupResult, SiteManagerDropdownItem };

async function cachedSiteManagersForDropdown(
  principal: DomainPrincipal,
  page: number,
  limit: number,
  query?: string,
) {
  "use cache";

  cacheTag("site-managers");
  cacheLife(CACHE_PROFILES.MEDIUM);

  return listSiteManagersForDropdown(principal, { limit, page, query }, prisma);
}

export async function getCachedSiteManagersForDropdown(
  page = 1,
  limit = 10,
  query?: string,
) {
  return cachedSiteManagersForDropdown(
    await currentPrincipal(),
    page,
    limit,
    query,
  );
}

export async function getSiteManagersForDropdown(
  page = 1,
  limit = 10,
  query?: string,
) {
  return listSiteManagersForDropdown(
    await currentPrincipal(),
    { limit, page, query },
    prisma,
  );
}

/** The assignable staff member this id names, or null. */
export async function getSiteManagerById(siteManagerId: string) {
  return findAssignableSiteManager(siteManagerId, prisma);
}
