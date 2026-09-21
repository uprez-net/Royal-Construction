import { clerkClient } from "@/lib/auth";
import { Role } from "@prisma/client";
import { requireAdminUser } from "@/lib/auth/require-admin";
import prisma from "@/lib/prisma";
import { findUserById } from "@/lib/domain/identity/users";
import {
  inviteTeamMember,
  revokeTeamInvitation,
} from "@/lib/domain/identity/team";
import { userPrincipal } from "@/lib/domain/principal";
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
import { NextRequest } from "next/server";

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

    return successResponse({
      users: users.data,
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
      { email, role },
      (input) => clerkClient.invitations.createInvitation(input),
    );

    return successResponse({
      message: "Invitation sent successfully",
      success: true,
      invitation,
    });
  } catch (error) {
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

    const updatedUser = await clerkClient.users.updateUser(userId, {
      publicMetadata: { role: newRole },
    });
    return successResponse({
      message: "User role updated successfully",
      success: true,
      user: updatedUser,
    });
  } catch (error) {
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
      (id) => clerkClient.invitations.revokeInvitation(id),
    );

    return successResponse({
      message: "Invitation revoked successfully",
      success: true,
      invitationId: revoked.invitationId,
    });
  } catch (error) {
    console.error("/api/users DELETE error", error);
    return errorResponse("Failed to delete user", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
