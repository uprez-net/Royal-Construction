import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { reconcileProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const reconcileSchema = z.object({ outcome: z.enum(["sent", "not_sent"]) });

/** Settle a group send WhatsApp never confirmed, after checking the group. */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string; messageId: string }> },
) {
  const { projectId, messageId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, reconcileSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const message = await reconcileProjectWhatsAppMessage(
      principal,
      { messageId, outcome: parsed.data.outcome, projectId },
      prisma,
    );
    return successResponse({ message });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Group reconcile failed", error);
    return errorResponse("The message could not be reconciled.", {
      code: "PROJECT_WHATSAPP_RECONCILE_FAILED",
      status: 500,
    });
  }
}
