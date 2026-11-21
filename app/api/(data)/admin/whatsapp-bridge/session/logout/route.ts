import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { disconnectWhatsAppBridge } from "@/lib/domain/integrations/whatsapp-bridge";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Unlink the bridge from Royal's number. Group sync stops until a new scan. Administrators only (lib/domain/integrations/whatsapp-bridge.ts). */
export async function POST() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await disconnectWhatsAppBridge(principal, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not disconnect the WhatsApp bridge.",
      error,
    );
    return errorResponse("Could not disconnect the WhatsApp bridge.", {
      code: "WHATSAPP_BRIDGE_LOGOUT_FAILED",
      status: 500,
    });
  }
}
