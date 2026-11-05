import type { NextRequest } from "next/server";
import { z } from "zod";

import { parsePositiveId, signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { reconcileLeadSms } from "@/lib/domain/comms/sms/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Settle a text the provider never confirmed: a person says what they found. */
const bodySchema = z.object({ outcome: z.enum(["sent", "not_sent"]) });

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string; messageId: string }> },
) {
  const params = await ctx.params;
  const leadId = parsePositiveId(params.leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const message = await reconcileLeadSms(
      principal,
      { leadId, messageId: params.messageId, outcome: parsed.data.outcome },
      prisma,
    );
    return successResponse({ message });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[sms] Reconcile failed", error);
    return errorResponse("Could not settle the text.", { code: "SMS_RECONCILE_FAILED", status: 500 });
  }
}
