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
 * Clerk's own sentence ("phone_number must be a valid phone number in E.164
 * format", "That phone number is taken") rather than the bare status text its
 * error class carries as `message`.
 */
function clerkReason(error: unknown): Error {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    return new Error(first?.longMessage || first?.message || error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Make `phone` the user's primary Clerk number, then set the name.
 *
 * Created already verified: the number is a contact detail the office reads
 * on screen, not a sign-in factor, so there is no code to send. Any other
 * number on the account is removed so Clerk shows one, unless it is reserved
 * as a second factor — deleting that would quietly turn off someone's MFA.
 */
const writeClerkProfile: TeamProfilePort = async ({
  clerkUserId,
  firstName,
  lastName,
  phone,
}) => {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const existing = user.phoneNumbers.find(
      (number) => number.phoneNumber === phone,
    );
    if (!existing) {
      await clerkClient.phoneNumbers.createPhoneNumber({
        phoneNumber: phone,
        primary: true,
        userId: clerkUserId,
        verified: true,
      });
    } else if (user.primaryPhoneNumberId !== existing.id) {
      await clerkClient.phoneNumbers.updatePhoneNumber(existing.id, {
        primary: true,
      });
    }
    for (const stale of user.phoneNumbers) {
      if (stale.phoneNumber === phone || stale.reservedForSecondFactor) {
        continue;
      }
      await clerkClient.phoneNumbers.deletePhoneNumber(stale.id);
    }
    await clerkClient.users.updateUser(clerkUserId, { firstName, lastName });
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
