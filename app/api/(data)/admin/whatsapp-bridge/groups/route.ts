import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listWhatsAppBridgeGroups } from "@/lib/domain/projects/whatsapp/groups";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Every group Royal's WhatsApp number is in, with the project each is linked to. */
export async function GET() {
  // Live state: never prerendered (Cache Components prerenders a
  // parameterless GET that does not ask for the request).
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await listWhatsAppBridgeGroups(principal, prisma, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse({ groups: result });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not list the WhatsApp groups.",
      error,
    );
    return errorResponse("Could not list the WhatsApp groups.", {
      code: "WHATSAPP_BRIDGE_GROUPS_FAILED",
      status: 500,
    });
  }
}
