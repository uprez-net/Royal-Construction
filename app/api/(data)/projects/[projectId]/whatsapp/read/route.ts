import type { NextRequest } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { markProjectWhatsAppRead } from "@/lib/domain/projects/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** The office has read the project's group. */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await markProjectWhatsAppRead(principal, { projectId }, prisma);
    return successResponse({ read: true });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Marking a group read failed", error);
    return errorResponse("Could not mark the group as read.", {
      code: "PROJECT_WHATSAPP_READ_MARK_FAILED",
      status: 500,
    });
  }
}
