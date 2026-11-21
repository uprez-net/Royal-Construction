import "server-only";

import { projectReadScope } from "@/lib/domain/access/projects";
import { cache } from "react";
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
import {
  needingAttention,
  readProjectAttention,
  type ProjectAttention,
} from "@/lib/domain/projects/attention";
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
 * A page of projects. Throws when the read fails (#486).
 *
 * This used to swallow the error and answer an empty page, so a failed
 * database read looked exactly like "you have no projects": the API answered
 * 200 with `items: []`, the Projects list said "No projects yet", and the
 * dashboard said "No projects found". Callers now decide how a failure
 * shows: `GET /api/projects` answers 500, the dashboard's
 * `settleDashboardSection` logs and raises its warning banner, and the Projects page
 * uses `getProjectsPage` below.
 */
export async function getProjects(
  query?: ProjectListQuery,
): Promise<PaginatedProjectsResult> {
  return listProjects(await currentPrincipal(), query, prisma);
}

/**
 * `getProjects` for a screen that renders the list beside other panels, where
 * a thrown read would blank the whole route. A failed read says so in
 * `failed` instead of answering an empty list, so the screen can say "could
 * not load" rather than "no projects" (the same shape as
 * `getProjectsNeedingAttention`).
 */
export async function getProjectsPage(query?: ProjectListQuery): Promise<{
  page: PaginatedProjectsResult;
  failed: boolean;
}> {
  try {
    return { page: await getProjects(query), failed: false };
  } catch (error) {
    console.error("Error fetching projects:", error);
    return {
      page: {
        items: [],
        page: query?.page ?? 1,
        limit: query?.limit ?? 12,
        totalCount: 0,
        totalPages: 1,
      },
      failed: true,
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

/**
 * `getProjectById`, once per request. The project page asks for the project
 * twice, for its metadata and for its body, and both share this one read.
 *
 * React's `cache` lasts for one server render, so it never carries a project
 * from one request (or one caller) into the next. The route handlers that
 * re-read a project after writing it call `getProjectById` directly, so they
 * always see their own write.
 */
export const getProjectForPage = cache(getProjectById);

export async function getAllProjectsForExport(): Promise<ProjectWithStats[]> {
  try {
    return await listAllProjectsForExport(await currentPrincipal(), prisma);
  } catch (error) {
    console.error("Error fetching projects for export:", error);
    return [];
  }
}

/**
 * Every project needing attention, most urgent first, for the Projects page's
 * Alerts card (issues #451, #452).
 *
 * Uncached on purpose: whether an activity is overdue turns on today's date,
 * and the conditions come from tables that never expire the "projects" tag.
 *
 * A failed read says so in `failed` rather than answering an empty list: an
 * empty Alerts card reads as "nothing is overdue", which is the one wrong
 * answer this card exists to prevent. It still does not throw, because the
 * card is one panel among several and must not blank the list beneath it.
 */
export type ProjectAttentionResult = {
  projects: ProjectAttention[];
  failed: boolean;
};

export async function getProjectsNeedingAttention(): Promise<ProjectAttentionResult> {
  try {
    return {
      projects: needingAttention(
        await readProjectAttention(await currentPrincipal(), prisma),
      ),
      failed: false,
    };
  } catch (error) {
    console.error("Error reading project attention:", error);
    return { projects: [], failed: true };
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

async function cachedProjectById(principal: DomainPrincipal, id: string) {
  "use cache";

  cacheTag(`project-${id}`);
  cacheTag("milestone-trade-dependencies");
  cacheLife(CACHE_PROFILES.LONG);

  return getProjectDetail(principal, id, prisma);
}

export async function getCachedProjectById(id: string) {
  const principal = await currentPrincipal();
  // The read rule, asked here and not only inside the cached read below: an
  // account that may not read projects at all (a GUEST past the proxy) is
  // refused as a `DomainError` the route can answer, instead of one thrown
  // inside the cache, which the caller may not see as one.
  projectReadScope(principal);
  return cachedProjectById(principal, id);
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
