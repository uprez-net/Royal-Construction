import { auth } from "@clerk/nextjs/server";
import { Role } from "@prisma/client";

import { getUserByClerkIdCached } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Why a compliance request was refused, and with what status.
 *
 * Carried as a class rather than as a thrown string so the routes can map it
 * to a response in one place, the way lib/offer/access.ts does for leads.
 */
export class ComplianceAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = "ComplianceAccessError";
  }
}

export type ComplianceActor = {
  id: string;
  role: Role;
  name: string;
  email: string;
  /** Set only for CUSTOMER users; the project gate compares against it. */
  customerId: string | null;
};

/**
 * The signed-in user, or a 401.
 *
 * Written as its own step because the nested project routes in this codebase
 * are inconsistent about it — add-photos and milestones POST have no auth check
 * at all. The compliance routes do not inherit that.
 */
async function requireUser(): Promise<ComplianceActor> {
  const { userId } = await auth();
  if (!userId) {
    throw new ComplianceAccessError("Not authenticated", 401);
  }

  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new ComplianceAccessError("Not authenticated", 401);
  }

  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    customerId: user.customerId ?? null,
  };
}

/**
 * The user, plus the engagement on this project, for anyone who may edit it.
 *
 * The gate is the same one PATCH /api/projects/[projectId] uses: whoever may
 * change the project may run its compliance flow. A customer is included
 * deliberately — they are the ones whose documents these are — and the one
 * thing they cannot do is resolve a document, which goes through
 * {@link requireComplianceAdmin} instead.
 *
 * @param projectId - The project the request names.
 * @param options.requireEngagement - Throw 404 when no engagement has been
 * started yet. Off for the route that starts one.
 */
export async function requireComplianceAccess(
  projectId: string,
  options: { requireEngagement?: boolean } = {},
) {
  const user = await requireUser();

  const project = await prisma.project.findUnique({
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

  if (!project) {
    throw new ComplianceAccessError("Project not found", 404);
  }

  const canEditProject =
    user.role === Role.ADMIN ||
    project.siteManagerId === user.id ||
    project.Lead.assignedId === user.id ||
    (user.role === Role.CUSTOMER && user.customerId === project.customerId);

  if (!canEditProject) {
    throw new ComplianceAccessError(
      "You do not have access to this project's compliance file.",
      403,
    );
  }

  if (options.requireEngagement !== false && !project.certifierEngagement) {
    throw new ComplianceAccessError(
      "No certifier engagement has been started for this project.",
      404,
    );
  }

  return { user, project, engagement: project.certifierEngagement };
}

/**
 * An admin, and nothing else.
 *
 * Approving or rejecting a compliance document is the same class of act as
 * resolving a tradie approval, and is gated the same way: it is the decision
 * that freezes a document or sends it back, and it must not be available to
 * the person who uploaded it.
 */
export async function requireComplianceAdmin(
  projectId: string,
): Promise<ComplianceActor> {
  const user = await requireUser();

  if (user.role !== Role.ADMIN) {
    throw new ComplianceAccessError(
      "Only an admin can approve or reject compliance documents.",
      403,
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    throw new ComplianceAccessError("Project not found", 404);
  }

  return user;
}

/**
 * Maps an access failure to a response, so every compliance route refuses the
 * same way instead of each inventing its own status code. Returns null for any
 * other error, which the caller should treat as a 500.
 */
export function complianceAccessResponse(error: unknown) {
  if (!(error instanceof ComplianceAccessError)) {
    return null;
  }
  switch (error.status) {
    case 401:
      return unauthorizedResponse(error.message);
    case 403:
      return forbiddenResponse(error.message);
    default:
      return errorResponse(error.message, {
        status: 404,
        code: "NOT_FOUND",
      });
  }
}
