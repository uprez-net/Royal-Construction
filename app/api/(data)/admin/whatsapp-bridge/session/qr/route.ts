import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { getWhatsAppBridgeQr } from "@/lib/domain/integrations/whatsapp-bridge";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** The login QR to scan in WhatsApp › Linked devices, or null when there is none. Administrators only (lib/domain/integrations/whatsapp-bridge.ts). */
export async function GET() {
  // Live state: never prerendered (Cache Components prerenders a
  // parameterless GET that does not ask for the request).
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await getWhatsAppBridgeQr(principal, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not read the WhatsApp bridge's QR code.",
      error,
    );
    return errorResponse("Could not read the WhatsApp bridge's QR code.", {
      code: "WHATSAPP_BRIDGE_QR_FAILED",
      status: 500,
    });
  }
}
