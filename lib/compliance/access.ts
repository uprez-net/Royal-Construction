import { auth } from "@clerk/nextjs/server";
import { Role } from "@prisma/client";

import { getUserByClerkIdCached } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import {
  authorizeComplianceAccess,
  authorizeComplianceDecision,
} from "@/lib/domain/access/compliance";
import { isDomainError } from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";
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

/** An expected, user-safe compliance domain failure. */
export class ComplianceDomainError extends Error {
  constructor(
    message: string,
    readonly code = "BAD_REQUEST",
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ComplianceDomainError";
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
  try {
    const { engagement, project } = await authorizeComplianceAccess(
      userPrincipal(user),
      projectId,
      prisma,
      options,
    );
    return { user, project, engagement };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    throw new ComplianceAccessError(
      error.message,
      error.status === 404 ? 404 : 403,
    );
  }
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

  try {
    await authorizeComplianceDecision(userPrincipal(user), projectId, prisma);
    return user;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    throw new ComplianceAccessError(
      error.message,
      error.status === 404 ? 404 : 403,
    );
  }
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

/** Maps expected compliance failures without exposing infrastructure errors. */
export function complianceErrorResponse(error: unknown) {
  const accessResponse = complianceAccessResponse(error);
  if (accessResponse) return accessResponse;

  if (error instanceof ComplianceDomainError) {
    return errorResponse(error.message, {
      status: error.status,
      code: error.code,
    });
  }

  return null;
}
