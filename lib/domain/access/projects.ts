import { ComplianceDocumentType, Role } from "@prisma/client";

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
 * The office is on shared ADMIN logins, so this refuses them nothing; it is
 * what holds a site manager (one exists since November 2026) to the projects
 * they are assigned. Reading is wider (`projectReadScope`) and money is
 * narrower (`canSeeProjectFinancials`).
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
 * Record scope: the site work a site manager is there for — the stage
 * checklists, an activity's progress, notes and photos, and the project's
 * WhatsApp messages.
 *
 * Wider than `canManageProject` by one clause: any site manager, on every
 * project, not only the ones whose Site manager field names them. The owner's
 * call (2026-11-20, reversing #573's "assigned only"): site managers record on
 * every job, and production had no project assigned to one. Everything else a
 * manager may do — planning activities, bookings, materials, setting up the
 * WhatsApp group — stays on `canManageProject` or narrower. Deciding a
 * variation moves the contract value, so it is the office's money
 * (`canSeeProjectFinancials`), not this rule.
 */
export function canRecordOnProject(
  principal: DomainPrincipal,
  project: ManageableProject,
): boolean {
  if (canManageProject(principal, project)) return true;
  return isUserPrincipal(principal) && principal.role === Role.SITE_MANAGER;
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

/**
 * Read scope: who may SEE a project, which is wider than who may manage one.
 *
 * Staff see every project — that is what the projects list is. A customer
 * portal account sees only the projects that belong to its own customer
 * record. Nobody signed out sees any.
 *
 * **This is a deliberate behaviour change, flagged rather than assumed.**
 * `lib/data/projects.ts` applied no scope at all: `getProjects`,
 * `getProjectsForLookup`, `getProjectById` and the KPI roll-up answered the
 * same thing for every signed-in caller, and `app/api/(data)/projects/route.ts`
 * has no guard of its own beyond the middleware's "is anybody signed in".
 * With two or three staff who are all ADMIN that changes nothing internally.
 * It matters for a CUSTOMER account, which could list every other customer's
 * job, budget and site address — the expensive kind of wrong here, because a
 * client sees it.
 *
 * The narrow shape is a `where` fragment callers spread, so one filter covers
 * the list, the lookup and the single read (a project outside scope then reads
 * as absent rather than forbidden, which is the right answer for a caller who
 * should not learn it exists).
 */
export function projectReadScope(principal: DomainPrincipal): {
  customerId?: string;
} {
  if (principal.kind === "system") return {};
  if (isUserPrincipal(principal)) {
    if (isInternalRole(principal.role)) return {};
    if (principal.role === Role.CUSTOMER) {
      // A CUSTOMER with no customerId matches no project rather than all of
      // them: `{ customerId: undefined }` would drop the filter entirely.
      return { customerId: principal.customerId ?? NO_SUCH_CUSTOMER };
    }
  }
  throw new DomainAuthorizationError(
    "Viewing projects requires a signed-in user.",
  );
}

/**
 * May this caller see what a project costs and earns?
 *
 * The contract sum, budgets and spend, variations, progress claims, tradie
 * quotes and tradie invoices. ADMIN and the system (a cron, a webhook) only:
 * a site manager works the build, and every screen they are given already
 * hides the money behind `isAdmin`, so this is that rule made true of the
 * payload too. A payload the screen does not draw is still a payload the
 * browser holds and `/api/projects` hands over, which is why the answer is
 * decided here and not left to the component.
 *
 * Allow-list, not "not a site manager": a role added later sees no money until
 * someone says it may. The customer portal is held to it as well — its screens
 * never drew the budget, so nothing a customer sees changes.
 */
export function canSeeProjectFinancials(principal: DomainPrincipal): boolean {
  if (principal.kind === "system") return true;
  return isUserPrincipal(principal) && principal.role === Role.ADMIN;
}

/**
 * Recording HBCF on a project — uploading a certificate or claim document and
 * reading its number and amount — is the office's, under the same rule as
 * seeing the money: the claim amounts are what the HBCF pool is counted from.
 */
export function assertCanRecordHbcf(principal: DomainPrincipal): void {
  if (!canSeeProjectFinancials(principal)) {
    throw new DomainAuthorizationError(
      "HBCF insurance documents are recorded by the office.",
    );
  }
}

/**
 * Filing a document on a project's compliance file, by type. The HBCF
 * certificate is the office's (`assertCanRecordHbcf`): filing it copies its
 * number and file onto the project's HBCF record. Every other type is open to
 * whoever may work the compliance file.
 */
export function assertCanFileComplianceDocument(
  principal: DomainPrincipal,
  documentType: ComplianceDocumentType,
): void {
  if (documentType === ComplianceDocumentType.HOME_INSURANCE) {
    assertCanRecordHbcf(principal);
  }
}

/**
 * A customer id no record carries, so a CUSTOMER principal whose account has
 * no customer link matches nothing instead of everything.
 */
const NO_SUCH_CUSTOMER = "__no_customer__";

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

/** Assert this caller may record site work on this project, and return it. */
export async function authorizeProjectRecording(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<AuthorizedProject> {
  const project = await db.project.findUnique({
    select: { id: true, location: true, name: true, siteManagerId: true },
    where: { id: projectId },
  });

  if (!project) throw new DomainNotFoundError("Project not found");
  if (!canRecordOnProject(principal, project)) {
    throw new DomainAuthorizationError(
      "You do not have access to this project",
    );
  }
  return project;
}

/** `authorizeProjectRecording` for the project a milestone belongs to. */
export async function authorizeMilestoneRecording(
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
    project: await authorizeProjectRecording(
      principal,
      milestone.projectId,
      db,
    ),
  };
}

/**
 * Booking tradies — asking for quotes, booking, moving or cancelling a
 * booking, recording a quote, reminding a tradie — is the office's. Every one
 * of them handles a price, so it follows the money rule; a site manager sees
 * who is booked and when, not the booking controls (owner, 2026-11-20).
 */
export function canBookTradies(principal: DomainPrincipal): boolean {
  return canSeeProjectFinancials(principal);
}

export function assertCanBookTradies(principal: DomainPrincipal): void {
  if (!canBookTradies(principal)) {
    throw new DomainAuthorizationError(
      "Tradie bookings are made by the office.",
    );
  }
}

/**
 * Setting up a project's WhatsApp group (create it, link one, invite the
 * owners) is the office's. A site manager reads and posts in the group once
 * it exists (`canRecordOnProject`).
 */
export function canSetUpProjectWhatsAppGroup(
  principal: DomainPrincipal,
): boolean {
  return canSeeProjectFinancials(principal);
}

export function assertCanSetUpProjectWhatsAppGroup(
  principal: DomainPrincipal,
): void {
  if (!canSetUpProjectWhatsAppGroup(principal)) {
    throw new DomainAuthorizationError(
      "The office sets up the project's WhatsApp group.",
    );
  }
}

/**
 * A project's History tab (the activity log: who changed what, some lines
 * naming an amount) is the office's audit trail, not site work.
 */
export function canSeeProjectHistory(principal: DomainPrincipal): boolean {
  return canSeeProjectFinancials(principal);
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

export type EditableProject = {
  readonly id: string;
  readonly name: string;
  readonly location: string;
  readonly siteManagerId: string | null;
  readonly customerId: string;
  readonly leadAssignedId: string | null;
};

/**
 * Edit scope: who may change a project's own fields — its name, location,
 * dates, budget and requirements payload.
 *
 * Wider than manage scope by one clause, and narrower by another. Both are
 * deliberate, and both come from `app/api/(data)/projects/[projectId]/route.ts`,
 * which spelled this rule out inline as `canEditProject`:
 *
 *   - **Kept:** the assignee of the lead this project came from. The
 *     salesperson who converted the lead keeps their edit rights on the
 *     project. Free to keep, and removing it would be a behaviour change
 *     nobody asked for. (Moot today — everyone is an ADMIN on a shared login —
 *     and real once Projects brings site managers.)
 *   - **Removed, deliberately:** the owning CUSTOMER. The inline rule let a
 *     customer-portal account PATCH the project it belongs to, and that route
 *     accepts `totalBudget`, `startDate` and the whole `requirements` payload
 *     — the contract sum, the claim stages and the signed date. A client
 *     editing the commercial terms of their own build is the expensive kind of
 *     wrong here, and no screen offers it: the Overview tab that PATCHes this
 *     is staff-only. A customer keeps their read through `projectReadScope`.
 */
export function canEditProject(
  principal: DomainPrincipal,
  project: Pick<EditableProject, "siteManagerId" | "leadAssignedId">,
): boolean {
  if (principal.kind === "system") return true;
  if (!isUserPrincipal(principal)) return false;
  if (principal.role === Role.ADMIN) return true;
  if (!isInternalRole(principal.role)) return false;
  return (
    project.siteManagerId === principal.userId
    || project.leadAssignedId === principal.userId
  );
}

/** Assert this caller may edit this project's own fields, and return it. */
export async function authorizeProjectEdit(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<EditableProject> {
  const project = await db.project.findUnique({
    select: {
      id: true,
      customerId: true,
      Lead: { select: { assignedId: true } },
      location: true,
      name: true,
      siteManagerId: true,
    },
    where: { id: projectId },
  });

  if (!project) throw new DomainNotFoundError("Project not found");

  const editable: EditableProject = {
    customerId: project.customerId,
    id: project.id,
    leadAssignedId: project.Lead?.assignedId ?? null,
    location: project.location,
    name: project.name,
    siteManagerId: project.siteManagerId,
  };

  if (!canEditProject(principal, editable)) {
    throw new DomainAuthorizationError(
      "You do not have access to update this project.",
    );
  }
  return editable;
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
    user.role === Role.CUSTOMER
    && Boolean(user.customerId)
    && user.customerId === project.customerId
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
