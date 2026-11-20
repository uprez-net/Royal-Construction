import { Role } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import {
  isInternalPrincipal,
  isUserPrincipal,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";

export type ComplianceFileProject = {
  readonly siteManagerId: string | null;
  readonly customerId: string;
  /** The assignee of the lead the project came from. */
  readonly leadAssignedId: string | null;
};

/**
 * Compliance edit scope is intentionally wider than project management.
 *
 * The project's site manager and originating lead assignee may work the file,
 * and the owning customer may supply their own evidence. Decisions that settle
 * evidence remain admin-only through `authorizeComplianceDecision`.
 *
 * Pure, so the project page can ask it to decide whether to draw the
 * compliance actions at all (#568) rather than draw ones that are refused.
 */
export function canWorkComplianceFile(
  principal: DomainPrincipal,
  project: ComplianceFileProject,
): boolean {
  if (!isUserPrincipal(principal)) return false;
  // The compliance file is the office's paperwork (DA and CC documents, the
  // certifier's emails, the HBCF certificate, the build cost summary), not
  // site work: a site manager does not see or work it, assigned or not
  // (owner, 2026-11-20).
  if (principal.role === Role.SITE_MANAGER) return false;
  return (
    principal.role === Role.ADMIN
    || project.siteManagerId === principal.userId
    || project.leadAssignedId === principal.userId
    || (principal.role === Role.CUSTOMER
      && principal.customerId === project.customerId)
  );
}

/** `canWorkComplianceFile`, asserted, with the project and its engagement. */
export async function authorizeComplianceAccess(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
  options: { requireEngagement?: boolean } = {},
) {
  if (!isUserPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Viewing compliance requires a signed-in user.",
    );
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      customerId: true,
      siteManagerId: true,
      location: true,
      Lead: { select: { assignedId: true } },
      certifierEngagement: { select: { id: true, status: true } },
    },
  });
  if (!project) throw new DomainNotFoundError("Project not found");

  const allowed = canWorkComplianceFile(principal, {
    customerId: project.customerId,
    leadAssignedId: project.Lead?.assignedId ?? null,
    siteManagerId: project.siteManagerId,
  });
  if (!allowed) {
    throw new DomainAuthorizationError(
      "You do not have access to this project's compliance file.",
    );
  }
  if (options.requireEngagement !== false && !project.certifierEngagement) {
    throw new DomainNotFoundError(
      "No certifier engagement has been started for this project.",
    );
  }

  return { engagement: project.certifierEngagement, project };
}

/** Staff-channel mutation scope, including authenticated crons/workflows. */
export async function authorizeComplianceMutation(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  if (principal.kind === "system") {
    // The same shape the staff branch returns, so a caller that needs the
    // engagement reads it the same way whichever channel it came in on. A
    // system caller skips the per-user clauses, not the engagement check.
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        customerId: true,
        siteManagerId: true,
        location: true,
        Lead: { select: { assignedId: true } },
        certifierEngagement: { select: { id: true, status: true } },
      },
    });
    if (!project) throw new DomainNotFoundError("Project not found");
    if (!project.certifierEngagement) {
      throw new DomainNotFoundError(
        "No certifier engagement has been started for this project.",
      );
    }
    return { engagement: project.certifierEngagement, project };
  }
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "This compliance change requires an internal staff account.",
    );
  }
  return authorizeComplianceAccess(principal, projectId, db);
}

/** A compliance decision is admin-only and still verifies the project. */
export async function authorizeComplianceDecision(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  requireAdminPrincipal(principal);
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new DomainNotFoundError("Project not found");
  return project;
}
