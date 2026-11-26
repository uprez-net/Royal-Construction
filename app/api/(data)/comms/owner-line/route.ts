import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  clearOwnerLine,
  getOwnerLine,
  setOwnerLine,
  type OwnerLineRecord,
} from "@/lib/domain/comms/owner-line";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The owner line (GET, staff; PUT and DELETE, admin): the business owner's
 * own phone, where Mili rings with a briefing Hermes asked for.
 */

const saveSchema = z.object({
  nickname: z.string().max(200),
  number: z.string().max(40),
});

function dto(line: OwnerLineRecord | null) {
  return line ? { e164: line.e164, nickname: line.nickname } : null;
}

export async function GET() {
  // Per request, never prerendered: the setting is live.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      ownerLine: dto(await getOwnerLine(principal, prisma)),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Loading the owner line failed", error);
    return errorResponse("Could not load the owner line.", {
      code: "OWNER_LINE_LOAD_FAILED",
      status: 500,
    });
  }
}

export async function PUT(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, saveSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const line = await setOwnerLine(principal, parsed.data, prisma, {
      channel: commsRuntimeFromEnv().channel,
    });
    return successResponse({ ownerLine: dto(line) });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Saving the owner line failed", error);
    return errorResponse("Could not save the owner line.", {
      code: "OWNER_LINE_SAVE_FAILED",
      status: 500,
    });
  }
}

export async function DELETE() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await clearOwnerLine(principal, prisma);
    return successResponse({ ownerLine: null });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Clearing the owner line failed", error);
    return errorResponse("Could not clear the owner line.", {
      code: "OWNER_LINE_CLEAR_FAILED",
      status: 500,
    });
  }
}
