import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { connectWhatsAppBridge } from "@/lib/domain/integrations/whatsapp-bridge";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Start connecting the bridge, so a login QR appears. Administrators only (lib/domain/integrations/whatsapp-bridge.ts). */
export async function POST() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await connectWhatsAppBridge(principal, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not start the WhatsApp bridge.",
      error,
    );
    return errorResponse("Could not start the WhatsApp bridge.", {
      code: "WHATSAPP_BRIDGE_CONNECT_FAILED",
      status: 500,
    });
  }
}
