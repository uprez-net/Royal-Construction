import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { ringingWhatsAppCalls } from "@/lib/domain/leads/whatsapp/calls";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Customers calling on WhatsApp right now that nobody has answered. The
 * dock polls this every few seconds while the app is open and visible; one
 * indexed query, nothing written.
 */
export async function GET() {
  // Per request, never prerendered: the answer depends on who is asking.
  await connection();
  if (readWhatsAppConfig().channel?.callingEnabled !== true) {
    return successResponse({ calls: [], enabled: false });
  }
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      calls: await ringingWhatsAppCalls(principal, prisma),
      enabled: true,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Failed to list ringing calls", error);
    return errorResponse("Could not check for WhatsApp calls.", {
      code: "WHATSAPP_CALLS_FAILED",
      status: 500,
    });
  }
}
