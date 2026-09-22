import "server-only";

import { cacheTag, cacheLife } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  emptyProjectKPIs,
  getProjectDetail,
  getProjectKPIs as readProjectKPIs,
  listAllProjectsForExport,
  listProjects,
  listProjectsForLookup,
  type PaginatedProjectLookupResult,
  type PaginatedProjectsResult,
  type ProjectListQuery,
  type ProjectListSortBy,
  type ProjectLookupItem,
} from "@/lib/domain/projects/queries";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { CACHE_PROFILES } from "@/types/cache";
import type {
  ProjectDetail,
  ProjectKPIs,
  ProjectWithStats,
} from "@/types/project";

// The Next adapter over `lib/domain/projects/queries.ts`.
//
// Everything that was a rule here — the includes, the scope, the progress and
// variation arithmetic, the KPI roll-up — moved to the domain in phase 4, so
// Eve, a cron and a test runner read projects the same way a page does. What
// is left is genuinely framework work: resolving the Clerk principal, the
// `"use cache"` wrappers, and the cache tags.
//
// **The principal is part of every cache key.** A cached listing that did not
// carry one would serve whatever the first caller saw to everyone behind the
// same tag, which is how a scope becomes decorative.

export type {
  PaginatedProjectLookupResult,
  PaginatedProjectsResult,
  ProjectListQuery,
  ProjectListSortBy,
  ProjectLookupItem,
};

/**
 * A page of projects, or an empty page.
 *
 * The domain throws; this swallows, because the projects screen renders the
 * list beside four other panels and a thrown read blanks the route. The log
 * line is the difference between this and the old behaviour: it used to be
 * indistinguishable from "you have no projects".
 */
export async function getProjects(
  query?: ProjectListQuery,
): Promise<PaginatedProjectsResult> {
  try {
    return await listProjects(await currentPrincipal(), query, prisma);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return {
      items: [],
      page: query?.page ?? 1,
      limit: query?.limit ?? 12,
      totalCount: 0,
      totalPages: 1,
    };
  }
}

export async function getProjectsForLookup(
  page = 1,
  limit = 10,
  query?: string,
): Promise<PaginatedProjectLookupResult> {
  try {
    return await listProjectsForLookup(
      await currentPrincipal(),
      { limit, page, query },
      prisma,
    );
  } catch (error) {
    console.error("Error fetching projects for lookup:", error);
    return { items: [], page: 1, limit, totalCount: 0, totalPages: 1 };
  }
}

/**
 * The full project payload, or `null` when the caller may not see it.
 *
 * Still rethrows an unexpected database error — the detail page has nothing to
 * render without it, and a blank project screen that looks like a deleted
 * project is worse than an error boundary.
 */
export async function getProjectById(
  projectId: string,
): Promise<ProjectDetail | null> {
  try {
    return await getProjectDetail(await currentPrincipal(), projectId, prisma);
  } catch (error) {
    console.error("Error fetching project by ID:", error);
    throw error;
  }
}

export async function getAllProjectsForExport(): Promise<ProjectWithStats[]> {
  try {
    return await listAllProjectsForExport(await currentPrincipal(), prisma);
  } catch (error) {
    console.error("Error fetching projects for export:", error);
    return [];
  }
}

export async function getProjectKPIs(): Promise<ProjectKPIs> {
  try {
    return await readProjectKPIs(await currentPrincipal(), prisma);
  } catch (error) {
    console.error("Error fetching project KPIs:", error);
    return emptyProjectKPIs;
  }
}

// ---------------------------------------------------------------------------
// Cached reads
//
// Each one resolves the principal OUTSIDE the cached function and passes it in
// as an argument, so it becomes part of the cache key. `auth()` is a
// request-scoped API and cannot be called inside a `"use cache"` body at all,
// and a cache key that ignored who was asking would hand one caller's scope to
// the next.
// ---------------------------------------------------------------------------

async function cachedProjects(
  principal: DomainPrincipal,
  query: ProjectListQuery | undefined,
) {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  try {
    return await listProjects(principal, query, prisma);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return {
      items: [],
      page: query?.page ?? 1,
      limit: query?.limit ?? 12,
      totalCount: 0,
      totalPages: 1,
    } satisfies PaginatedProjectsResult;
  }
}

export async function getCachedProjects(query?: ProjectListQuery) {
  return cachedProjects(await currentPrincipal(), query);
}

async function cachedProjectById(principal: DomainPrincipal, id: string) {
  "use cache";

  cacheTag(`project-${id}`);
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectDetail(principal, id, prisma);
}

export async function getCachedProjectById(id: string) {
  return cachedProjectById(await currentPrincipal(), id);
}

async function cachedProjectKPIs(principal: DomainPrincipal) {
  "use cache";

  cacheTag("projects");
  cacheLife(CACHE_PROFILES.LONG);

  try {
    return await readProjectKPIs(principal, prisma);
  } catch (error) {
    console.error("Error fetching project KPIs:", error);
    return emptyProjectKPIs;
  }
}

export async function getCachedProjectKPIs() {
  return cachedProjectKPIs(await currentPrincipal());
}

async function cachedProjectsForLookup(
  principal: DomainPrincipal,
  page: number,
  limit: number,
  query?: string,
) {
  "use cache";

  cacheTag("projects");
  // equivalent to revalidate: 120
  cacheLife(CACHE_PROFILES.SHORT);

  try {
    return await listProjectsForLookup(
      principal,
      { limit, page, query },
      prisma,
    );
  } catch (error) {
    console.error("Error fetching projects for lookup:", error);
    return {
      items: [],
      page: 1,
      limit,
      totalCount: 0,
      totalPages: 1,
    } satisfies PaginatedProjectLookupResult;
  }
}

export async function getCachedProjectsForLookup(
  page = 1,
  limit = 10,
  query?: string,
) {
  return cachedProjectsForLookup(await currentPrincipal(), page, limit, query);
}
