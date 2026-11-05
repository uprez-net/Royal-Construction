import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { resolveUnmatchedSms } from "@/lib/domain/comms/sms/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** File an unmatched text onto a lead, or dismiss it. */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("attach"), leadId: z.number().int().positive() }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function POST(request: NextRequest, ctx: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, bodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const message = await resolveUnmatchedSms(principal, { ...parsed.data, messageId }, prisma);
    return successResponse({ message });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[sms] Filing an unmatched text failed", error);
    return errorResponse("Could not file the text.", { code: "SMS_FILE_FAILED", status: 500 });
  }
}
