import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { Role } from "@prisma/client";
import { z } from "zod";

import { clerkClient } from "@/lib/auth";
import { requireAdminUser } from "@/lib/auth/require-admin";
import prisma from "@/lib/prisma";
import {
  updateTeamMemberProfile,
  type TeamProfilePort,
} from "@/lib/domain/identity/team";
import { findUserById } from "@/lib/domain/identity/users";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
} from "@/utils/validators";

const updateTeamMemberProfileSchema = z.object({
  userId: z.string().trim().min(1, "User ID is required"),
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(1, "Phone number is required"),
});

/**
 * Clerk's own sentence rather than the bare status text its error class
 * carries as `message`.
 */
function clerkReason(error: unknown): Error {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    return new Error(first?.longMessage || first?.message || error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Set the name, and keep the phone in `publicMetadata.phone`.
 *
 * `updateUserMetadata` merges, so the `role` (and anything else) already in
 * public metadata is left alone — `updateUser({ publicMetadata })` would
 * replace the whole object and drop it. Clerk phone numbers are not used:
 * their verification and instance rules are for sign-in, not for a contact
 * number the office reads on screen.
 */
const writeClerkProfile: TeamProfilePort = async ({
  clerkUserId,
  firstName,
  lastName,
  phone,
}) => {
  try {
    await clerkClient.users.updateUser(clerkUserId, { firstName, lastName });
    await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: { phone },
    });
  } catch (error) {
    throw clerkReason(error);
  }
};

async function currentAdmin() {
  const access = await requireAdminUser();
  if (!access.ok) return null;
  const user = await findUserById(access.userId, prisma);
  return user && user.role === Role.ADMIN ? userPrincipal(user) : null;
}

/** Edit a team member's name and phone. The email is not editable here. */
export async function PATCH(request: NextRequest) {
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
      updateTeamMemberProfileSchema,
    );
    if (!body.success) return body.response;

    const profile = await updateTeamMemberProfile(
      principal,
      {
        clerkUserId: body.data.userId,
        name: body.data.name,
        phone: body.data.phone,
      },
      prisma,
      writeClerkProfile,
    );

    revalidateTag(`user-${profile.clerkUserId}`, CACHE_PROFILES.MEDIUM);
    revalidateTag("site-managers", CACHE_PROFILES.MEDIUM);
    // A site manager's name and phone are shown on every project they hold.
    revalidateTag("projects", CACHE_PROFILES.MEDIUM);

    const user = await clerkClient.users.getUser(profile.clerkUserId);
    return successResponse({
      message: "Team member updated",
      phone: profile.phone,
      success: true,
      user,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("/api/users/profile PATCH error", error);
    return errorResponse("Failed to update the team member", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
