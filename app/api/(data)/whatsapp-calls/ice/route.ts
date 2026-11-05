import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { browserIceServers } from "@/lib/comms/ice";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { isInternalPrincipal } from "@/lib/domain/principal";
import { forbiddenResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/** STUN/TURN servers for a staff browser's WhatsApp call. Short-lived credentials only. */
export async function GET() {
  const principal = await signedInUserPrincipal();
  if (!principal) return unauthorizedResponse();
  if (!isInternalPrincipal(principal)) return forbiddenResponse();
  return successResponse({ iceServers: await browserIceServers(commsRuntimeFromEnv()) });
}
