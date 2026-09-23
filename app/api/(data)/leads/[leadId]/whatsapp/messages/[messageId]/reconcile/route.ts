import type { NextRequest } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { reconcileLeadWhatsAppMessage } from "@/lib/domain/leads/whatsapp/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const reconcileBodySchema = z.object({
  outcome: z.enum(["sent", "not_sent"]),
});

/**
 * Settle a send WhatsApp never confirmed (#333).
 *
 * The operator checked WhatsApp Manager and says what happened. Only a
 * message flagged `needsReconciliation` can be settled; the domain refuses
 * the rest.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string; messageId: string }> },
) {
  const { leadId: rawLeadId, messageId: rawMessageId } = await ctx.params;
  const leadId = parsePositiveId(rawLeadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const messageId = rawMessageId.trim();
  if (!messageId || messageId.length > 64) {
    return badRequestResponse("Invalid message id.");
  }

  const parsed = await parseBodyWithResponse(request, reconcileBodySchema);
  if (!parsed.success) return parsed.response;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const message = await reconcileLeadWhatsAppMessage(
      principal,
      { leadId, messageId, outcome: parsed.data.outcome },
      prisma,
    );
    return successResponse(message);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to reconcile a message", error);
    return errorResponse("Could not reconcile the message.", {
      code: "WHATSAPP_RECONCILE_FAILED",
      status: 500,
    });
  }
}
