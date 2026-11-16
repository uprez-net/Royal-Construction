import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  createTeamPhone,
  listTeamPhones,
} from "@/lib/domain/comms/team-phones";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The team's phones (GET, any member of staff) and adding one (POST, admin).
 * "Call via phone" on a lead rings whichever one the caller picks.
 */

const createSchema = z.object({
  nickname: z.string().max(200),
  number: z.string().max(40),
});

export async function GET() {
  // Per request, never prerendered: the list is live and caller-dependent.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({ phones: await listTeamPhones(principal, prisma) });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Loading the team phones failed", error);
    return errorResponse("Could not load the team phones.", {
      code: "TEAM_PHONES_LOAD_FAILED",
      status: 500,
    });
  }
}

export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, createSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const phone = await createTeamPhone(principal, parsed.data, prisma, {
      channel: commsRuntimeFromEnv().channel,
    });
    return successResponse({ phone });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Adding a team phone failed", error);
    return errorResponse("Could not add the phone.", {
      code: "TEAM_PHONE_CREATE_FAILED",
      status: 500,
    });
  }
}
