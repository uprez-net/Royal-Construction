import { connection } from "next/server";

import prisma from "@/lib/prisma";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listUnmatchedWhatsAppMessages } from "@/lib/domain/leads/whatsapp/unmatched";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Inbound WhatsApp messages no single lead owns, waiting for a person (#333).
 * Pending only: attached and dismissed messages have been dealt with.
 */
export async function GET() {
  // Per request, never prerendered: the list depends on who is asking, and
  // under Cache Components a parameterless GET is otherwise built once at
  // deploy time with no session.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const list = await listUnmatchedWhatsAppMessages(principal, {}, prisma, {
      channel: whatsappChannelFromEnv(),
    });
    return successResponse(list);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to load unmatched messages", error);
    return errorResponse("Could not load unmatched WhatsApp messages.", {
      code: "WHATSAPP_UNMATCHED_FAILED",
      status: 500,
    });
  }
}
