import type { NextRequest } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  deleteTeamPhone,
  updateTeamPhone,
} from "@/lib/domain/comms/team-phones";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Rename a team phone or change its number (PATCH); remove it (DELETE). Admin. */

const updateSchema = z
  .object({
    nickname: z.string().max(200).optional(),
    number: z.string().max(40).optional(),
  })
  .refine((body) => body.nickname !== undefined || body.number !== undefined, {
    message: "Nothing to change.",
  });

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ phoneId: string }> },
) {
  const { phoneId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, updateSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const phone = await updateTeamPhone(
      principal,
      { ...parsed.data, id: phoneId },
      prisma,
      { channel: commsRuntimeFromEnv().channel },
    );
    return successResponse({ phone });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Updating a team phone failed", error);
    return errorResponse("Could not update the phone.", {
      code: "TEAM_PHONE_UPDATE_FAILED",
      status: 500,
    });
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ phoneId: string }> },
) {
  const { phoneId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await deleteTeamPhone(principal, { id: phoneId }, prisma);
    return successResponse({ removed: true });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Removing a team phone failed", error);
    return errorResponse("Could not remove the phone.", {
      code: "TEAM_PHONE_DELETE_FAILED",
      status: 500,
    });
  }
}
