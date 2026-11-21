import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { reconcileWhatsAppBridgeMappings } from "@/lib/domain/projects/whatsapp/group-links";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Tell the bridge exactly which groups to forward: the projects' linked ones. */
export async function POST() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await reconcileWhatsAppBridgeMappings(principal, prisma, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] Could not resync the WhatsApp bridge.",
      error,
    );
    return errorResponse("Could not resync the WhatsApp bridge.", {
      code: "WHATSAPP_BRIDGE_RESYNC_FAILED",
      status: 500,
    });
  }
}
