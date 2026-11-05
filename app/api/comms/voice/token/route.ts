import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { recordBrowserPresence } from "@/lib/domain/comms/calls/presence";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/**
 * A short-lived browser calling credential for the signed-in member of staff
 * (file 06 §8). Provider-neutral: the active provider issues it, and the
 * dialer picks its SDK from `provider`. The response carries no API secret,
 * only a credential that can *receive* calls — CRM calls are placed by the
 * server, so a leaked token cannot ring anyone.
 *
 * Asking for one also marks this browser as able to ring (inbound calls ring
 * staff seen in the last fifteen minutes).
 */

const CREDENTIAL_TTL_SECONDS = 600;

export async function GET() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    const adapter = runtime.channel?.callsAvailable ? runtime.active : null;
    if (!adapter?.issueBrowserCredential || !adapter.capabilities.browserSdkBundled) {
      return successResponse({
        available: false as const,
        provider: runtime.channel?.provider ?? null,
        reason: runtime.channel?.callsAvailable
          ? "This phone provider can't ring a browser here. Calls go to the office mobile."
          : "Calling isn't set up in this deployment.",
      });
    }
    const identity = await recordBrowserPresence(principal, prisma);
    const credential = await adapter.issueBrowserCredential(identity, CREDENTIAL_TTL_SECONDS);
    return successResponse({ available: true as const, ...credential });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Could not issue a browser credential");
    return errorResponse("The browser phone couldn't connect. It will try again shortly.", {
      code: "VOICE_TOKEN_FAILED",
      status: 502,
    });
  }
}
