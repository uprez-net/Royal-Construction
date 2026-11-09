import type { NextRequest } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  attachUnmatchedWhatsAppMessage,
  dismissUnmatchedWhatsAppMessage,
} from "@/lib/domain/leads/whatsapp/unmatched";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const reviewBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    leadId: z.number().int().positive(),
  }),
  z.object({ action: z.literal("dismiss") }),
]);

/**
 * File an unmatched inbound message on the lead a person chose, or dismiss it
 * (#333). The domain claims the row conditionally, so two people acting on the
 * same message cannot both succeed.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ unmatchedId: string }> },
) {
  const unmatchedId = (await ctx.params).unmatchedId.trim();
  if (!unmatchedId || unmatchedId.length > 64) {
    return badRequestResponse("Invalid message id.");
  }

  const parsed = await parseBodyWithResponse(request, reviewBodySchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    if (body.action === "dismiss") {
      await dismissUnmatchedWhatsAppMessage(principal, { unmatchedId }, prisma);
      return successResponse({ unmatchedId, status: "DISMISSED" });
    }
    const attached = await attachUnmatchedWhatsAppMessage(
      principal,
      { leadId: body.leadId, unmatchedId },
      prisma,
      { channel: whatsappChannelFromEnv() },
    );
    return successResponse({ ...attached, status: "ATTACHED" });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to review an unmatched message", error);
    return errorResponse("Could not update the message.", {
      code: "WHATSAPP_UNMATCHED_REVIEW_FAILED",
      status: 500,
    });
  }
}
