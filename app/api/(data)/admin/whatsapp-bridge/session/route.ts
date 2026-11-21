import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { getWhatsAppBridgeSession } from "@/lib/domain/integrations/whatsapp-bridge";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** The WhatsApp bridge's session: linked or not, and event delivery health. Administrators only (lib/domain/integrations/whatsapp-bridge.ts). */
export async function GET() {
  // Live state: never prerendered (Cache Components prerenders a
  // parameterless GET that does not ask for the request).
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await getWhatsAppBridgeSession(principal, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not read the WhatsApp bridge's status.",
      error,
    );
    return errorResponse("Could not read the WhatsApp bridge's status.", {
      code: "WHATSAPP_BRIDGE_SESSION_FAILED",
      status: 500,
    });
  }
}
