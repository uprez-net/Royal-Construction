import { clerkClient } from "@/lib/auth";
import { Role } from "@prisma/client";
import { requireAdminUser } from "@/lib/auth/require-admin";
import prisma from "@/lib/prisma";
import {
  findPhonesByClerkIds,
  findUserByClerkId,
  findUserById,
} from "@/lib/domain/identity/users";
import {
  changeTeamMemberRole,
  checkTeamMemberRoleChange,
  inviteTeamMember,
  recordRoleReconciliation,
  revokeTeamInvitation,
} from "@/lib/domain/identity/team";
import { userPrincipal } from "@/lib/domain/principal";
import { isDomainError } from "@/lib/domain/errors";
import {
  createUserInvitationSchema,
  errorResponse,
  parseBodyWithResponse,
  parseSearchParamsWithResponse,
  revokeUserInvitationSchema,
  successResponse,
  updateUserRoleSchema,
  userSearchQuerySchema,
} from "@/utils/validators";
import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";

import { CACHE_PROFILES } from "@/types/cache";

/**
 * A refused request is not a server fault. The domain errors carry the status
 * and the sentence to show — "The last admin cannot be demoted." is the whole
 * point of the guard, and it is useless to the one person who can act on it if
 * the route answers a bare 500.
 */
function domainErrorResponse(error: unknown) {
  if (!isDomainError(error)) return null;
  return errorResponse(error.message, {
    status: error.status,
    code: error.code.toUpperCase(),
  });
}

async function currentAdmin() {
  const access = await requireAdminUser();
  if (!access.ok) return null;
  const user = await findUserById(access.userId, prisma);
  return user && user.role === Role.ADMIN ? userPrincipal(user) : null;
}

export async function GET(request: NextRequest) {
  try {
    const principal = await currentAdmin();
    if (!principal) {
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
    const url = new URL(request.url);
    const params = parseSearchParamsWithResponse(url, userSearchQuerySchema);
    if (!params.success) {
      return params.response;
    }
    console.log("Received GET /api/users with params:", params);
    const users = await clerkClient.users.getUserList({
      limit: params.data.limit,
      offset: (params.data.userPage - 1) * params.data.limit,
      query: params.data.q,
    });

    const invites = await clerkClient.invitations.getInvitationList({
      limit: params.data.limit,
      offset: (params.data.invitePage - 1) * params.data.limit,
      query: params.data.q,
    });

    // The phone shown on the team screen is the stored one; Clerk's
    // publicMetadata.phone is only the fallback for a member with no row.
    const phones = await findPhonesByClerkIds(
      users.data.map((user) => user.id),
      prisma,
    );

    return successResponse({
      users: users.data,
      phones,
      invites: invites.data,
      userTotal: users.totalCount,
      inviteTotal: invites.totalCount,
    });
  } catch (error) {
    console.error("/api/users GET error", error);
    return errorResponse("Failed to fetch users", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await currentAdmin();
    if (!principal) {
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
    const body = await parseBodyWithResponse(
      request,
      createUserInvitationSchema,
    );
    if (!body.success) {
      return body.response;
    }
    const { email, role } = body.data;

    const invitation = await inviteTeamMember(
      principal,
      {
        email,
        idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
        role,
      },
      prisma,
      (input) => clerkClient.invitations.createInvitation(input),
    );

    return successResponse({
      message: invitation.alreadyInvited
        ? "This invitation was already sent today; nothing was sent again"
        : "Invitation sent successfully",
      success: true,
      invitation,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("/api/users POST error", error);
    return errorResponse("Failed to create user invitation", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const principal = await currentAdmin();
    if (!principal) {
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
    const body = await parseBodyWithResponse(request, updateUserRoleSchema);
    if (!body.success) {
      return body.response;
    }
    const { userId, newRole } = body.data;
    const target = await findUserByClerkId(userId, prisma);
    if (!target) {
      return errorResponse("Team member not found", {
        status: 404,
        code: "NOT_FOUND",
      });
    }
    if (target.role === newRole) {
      const updatedUser = await clerkClient.users.getUser(userId);
      return successResponse({
        message: "User role is already up to date",
        success: true,
        user: updatedUser,
      });
    }

    // Refused before Clerk hears of it: Clerk's user.updated webhook writes
    // the role straight to the database, so a change published here and then
    // refused would still land if the webhooks arrive out of order.
    await checkTeamMemberRoleChange(
      principal,
      { newRole, userId: target.id },
      prisma,
    );

    const updatedUser = await clerkClient.users.updateUser(userId, {
      publicMetadata: { role: newRole },
    });
    try {
      await changeTeamMemberRole(
        principal,
        {
          expectedRole: target.role,
          newRole,
          userId: target.id,
        },
        prisma,
      );
      // Every guard that reads the cached user would otherwise go on seeing
      // the old role for up to ten minutes.
      revalidateTag(`user-${userId}`, CACHE_PROFILES.MEDIUM);
      return successResponse({
        message: "User role updated successfully",
        success: true,
        user: updatedUser,
      });
    } catch (error) {
      try {
        await clerkClient.users.updateUser(userId, {
          publicMetadata: { role: target.role },
        });
      } catch (compensationError) {
        console.error(
          "Could not compensate Clerk after the local role transition failed",
          compensationError,
        );
        // Clerk now says one role and the database says another, and nothing
        // here can decide which is right. Leave a durable row rather than only
        // a log line and a 500 — with nobody watching logs, the next sign of
        // this is somebody reaching a screen they should not.
        const recorded = await recordRoleReconciliation(prisma, {
          clerkRole: newRole,
          clerkUserId: userId,
          localRole: target.role,
          reason:
            error instanceof Error
              ? error.message
              : "The local role transition failed.",
          userId: target.id,
        }).catch((recordError) => {
          console.error(
            "Could not record the role reconciliation",
            recordError,
          );
          return null;
        });
        return errorResponse(
          "Role update needs manual reconciliation between Clerk and the local team record",
          {
            status: 500,
            code: "RECONCILIATION_REQUIRED",
            ...(recorded ? { details: recorded.key } : {}),
          },
        );
      }
      throw error;
    }
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("/api/users PATCH error", error);
    return errorResponse("Failed to update user", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const principal = await currentAdmin();
    if (!principal) {
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
    const body = await parseBodyWithResponse(
      request,
      revokeUserInvitationSchema,
    );
    if (!body.success) {
      return body.response;
    }
    const { invitationId } = body.data;

    const revoked = await revokeTeamInvitation(
      principal,
      invitationId,
      prisma,
      (id) => clerkClient.invitations.revokeInvitation(id),
      request.headers.get("Idempotency-Key") ?? undefined,
    );

    return successResponse({
      message: "Invitation revoked successfully",
      success: true,
      invitationId: revoked.invitationId,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("/api/users DELETE error", error);
    return errorResponse("Failed to delete user", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
