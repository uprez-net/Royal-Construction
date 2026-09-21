import { Role } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import {
  type DomainPrincipal,
  isInternalRole,
  isUserPrincipal,
} from "../principal";

// Who may act on a project.
//
// Two different questions used to be answered by two different rules, in three
// different places, and it was not obvious they were different:
//
//   - "may this caller manage this project?" — ADMIN, or the project's own
//     site manager. lib/data/tradieSchedules.ts#userHasAccessToSchedule and
//     agent/lib/project-operations.ts#assertProjectAccess and
//     agent/lib/tradie-operations.ts each spelled this out separately, with
//     three different errors.
//   - "may this caller attach a file to this project?" — any staff role, or
//     the customer who owns it. lib/projects/project-access.ts, deliberately
//     wider, because every project screen offers staff its upload controls and
//     a narrower gate broke uploads the page had just offered.
//
// Both are kept, both are named for what they decide, and neither is quietly
// widened into the other.

export type ManageableProject = {
  readonly id: string;
  readonly siteManagerId: string | null;
};

/**
 * Manage scope: an ADMIN, or the site manager this project is assigned to.
 *
 * SITE_MANAGER is schema-only until Projects ships and everyone at Royal
 * Constructions is an ADMIN on a shared login, so today this refuses almost
 * nobody. It is written anyway because it is nearly free and because the
 * Projects section is what makes it real.
 */
export function canManageProject(
  principal: DomainPrincipal,
  project: ManageableProject,
): boolean {
  if (principal.kind === "system") return true;
  if (!isUserPrincipal(principal)) return false;
  if (principal.role === Role.ADMIN) return true;
  return project.siteManagerId === principal.userId;
}

/**
 * `canManageProject` as a query filter, for listings and for narrowing a
 * lookup so a forbidden project reads as absent.
 *
 * An empty object means "no filter". Callers spread it into a `where`.
 */
export function projectManageScope(principal: DomainPrincipal): {
  siteManagerId?: string;
} {
  if (principal.kind === "system") return {};
  if (isUserPrincipal(principal) && principal.role === Role.ADMIN) return {};
  if (isUserPrincipal(principal)) return { siteManagerId: principal.userId };
  throw new DomainAuthorizationError(
    "Listing projects requires a signed-in user.",
  );
}

export type AuthorizedProject = {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly siteManagerId: string | null;
};

/** Assert this caller may manage this project, and return it. */
export async function authorizeProject(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<AuthorizedProject> {
  const project = await db.project.findUnique({
    select: { id: true, location: true, name: true, siteManagerId: true },
    where: { id: projectId },
  });

  if (!project) throw new DomainNotFoundError("Project not found");
  if (!canManageProject(principal, project)) {
    throw new DomainAuthorizationError(
      "You do not have access to this project",
    );
  }
  return project;
}

/**
 * Assert this caller may manage the project a milestone belongs to.
 *
 * The milestone is resolved to its own project rather than trusted to belong
 * to a project named alongside it: both ids arrive from outside.
 */
export async function authorizeMilestone(
  principal: DomainPrincipal,
  milestoneId: string,
  db: DomainDb,
): Promise<{ milestoneId: string; project: AuthorizedProject }> {
  const milestone = await db.milestone.findUnique({
    select: { projectId: true },
    where: { id: milestoneId },
  });
  if (!milestone) throw new DomainNotFoundError("Milestone not found");
  return {
    milestoneId,
    project: await authorizeProject(principal, milestone.projectId, db),
  };
}

export type FileUploader = {
  readonly role: string;
  readonly customerId?: string | null;
};

export type FileTargetProject = {
  readonly customerId: string;
};

/**
 * Attach scope, deliberately wider than manage scope: any staff role, or the
 * customer who owns the project.
 *
 * Pure, so the decision is testable without a database. `role` is a string
 * rather than the Prisma enum so this stays callable from anywhere.
 */
export function canAttachFileToProject(
  user: FileUploader,
  project: FileTargetProject,
): boolean {
  if (isInternalRole(user.role as Role)) return true;
  return (
    user.role === Role.CUSTOMER &&
    Boolean(user.customerId) &&
    user.customerId === project.customerId
  );
}

/**
 * Assert a file may be attached to this project, or to one of its milestones,
 * and return the project it will actually land on.
 *
 * A milestone wins over the projectId sent alongside it, and a mismatch is a
 * 404 rather than a correction: an upload naming a milestone from another
 * project is not a request worth guessing at.
 */
export async function authorizeFileAttachment(
  user: FileUploader,
  target: { projectId?: string | null; milestoneId?: string | null },
  db: DomainDb,
): Promise<{ projectId: string }> {
  let projectId = target.projectId?.trim() || null;
  const milestoneId = target.milestoneId?.trim() || null;

  if (milestoneId) {
    const milestone = await db.milestone.findUnique({
      select: { projectId: true },
      where: { id: milestoneId },
    });
    if (!milestone || (projectId && milestone.projectId !== projectId)) {
      throw new DomainNotFoundError("Milestone not found");
    }
    projectId = milestone.projectId;
  }

  if (!projectId) throw new DomainNotFoundError("Project not found");

  const project = await db.project.findUnique({
    select: { customerId: true },
    where: { id: projectId },
  });
  if (!project) throw new DomainNotFoundError("Project not found");
  if (!canAttachFileToProject(user, project)) {
    throw new DomainAuthorizationError(
      "You do not have access to this project",
    );
  }

  return { projectId };
}
