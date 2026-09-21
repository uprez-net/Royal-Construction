import { Role } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import { type DomainPrincipal, isUserPrincipal } from "../principal";
import { canManageProject, projectManageScope } from "./projects";

// Who may see a tradie, and who may act on a booking.
//
// The directory and the schedule are scoped differently on purpose, and the
// reason is easy to lose: a site manager may pick ANY registered tradie for a
// booking — the directory is an internal coordination surface — but may only
// touch schedules on their own projects. Scope on the booking, not on the
// lookup. agent/lib/tradie-operations.ts had this right and
// lib/data/tradieSchedules.ts had the schedule half of it; both spelled it
// out separately.

/** Anyone who may browse the tradie directory at all. */
export function canReadTradieDirectory(principal: DomainPrincipal): boolean {
  if (principal.kind === "system") return true;
  return (
    isUserPrincipal(principal)
    && (principal.role === Role.ADMIN || principal.role === Role.SITE_MANAGER)
  );
}

export function assertCanReadTradieDirectory(principal: DomainPrincipal): void {
  if (!canReadTradieDirectory(principal)) {
    throw new DomainAuthorizationError(
      "You do not have access to the tradie directory.",
    );
  }
}

export type AuthorizedTradie = {
  readonly id: string;
  readonly name: string;
};

/** Assert this caller may see this tradie, and return it. */
export async function authorizeTradie(
  principal: DomainPrincipal,
  tradieId: string,
  db: DomainDb,
): Promise<AuthorizedTradie> {
  assertCanReadTradieDirectory(principal);

  const tradie = await db.tradie.findUnique({
    select: { id: true, name: true },
    where: { id: tradieId },
  });
  if (!tradie) throw new DomainNotFoundError("Tradie not found");
  return tradie;
}

export type AuthorizedSchedule = {
  readonly id: string;
  readonly projectId: string;
  readonly tradieId: string;
  readonly milestoneId: string | null;
};

/**
 * Assert this caller may act on this booking: it must sit on a project they
 * manage.
 *
 * Resolved through the schedule's own project rather than a projectId supplied
 * alongside it, so a booking cannot be reached by naming a project the caller
 * does happen to manage.
 */
export async function authorizeTradieSchedule(
  principal: DomainPrincipal,
  scheduleId: string,
  db: DomainDb,
): Promise<AuthorizedSchedule> {
  const schedule = await db.tradieSchedule.findUnique({
    select: {
      id: true,
      milestoneId: true,
      project: { select: { id: true, siteManagerId: true } },
      projectId: true,
      tradieId: true,
    },
    where: { id: scheduleId },
  });

  if (!schedule) throw new DomainNotFoundError("Schedule not found");
  if (!canManageProject(principal, schedule.project)) {
    throw new DomainAuthorizationError(
      "You do not have access to this schedule",
    );
  }

  return {
    id: schedule.id,
    milestoneId: schedule.milestoneId,
    projectId: schedule.projectId,
    tradieId: schedule.tradieId,
  };
}

/**
 * `authorizeTradieSchedule` as a query filter, for schedule listings.
 *
 * An empty object means "no filter"; otherwise the listing is narrowed to the
 * caller's own projects, which is the same rule the per-booking check applies.
 */
export function tradieScheduleListScope(principal: DomainPrincipal): {
  project?: { siteManagerId: string };
} {
  const scope = projectManageScope(principal);
  return scope.siteManagerId === undefined
    ? {}
    : { project: { siteManagerId: scope.siteManagerId } };
}
