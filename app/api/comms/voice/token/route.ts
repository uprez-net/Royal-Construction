import { connection } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { recordBrowserPresence } from "@/lib/domain/comms/calls/presence";
import { isCommsError } from "@/lib/domain/ports/comms";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { reportError } from "@/lib/observability/report-error";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

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
  // Per request, never prerendered: the answer depends on who is asking.
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    const adapter = runtime.channel?.callsAvailable ? runtime.active : null;
    if (
      !adapter?.issueBrowserCredential
      || !adapter.capabilities.browserSdkBundled
    ) {
      return successResponse({
        available: false as const,
        provider: runtime.channel?.provider ?? null,
        reason: runtime.channel?.callsAvailable
          ? "This phone provider can't ring a browser here. Calls go to the office mobile."
          : "Calling isn't set up in this deployment.",
      });
    }
    const identity = await recordBrowserPresence(principal, prisma);
    const credential = await adapter.issueBrowserCredential(
      identity,
      CREDENTIAL_TTL_SECONDS,
    );
    return successResponse({ available: true as const, ...credential });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    // The bare string this used to log carried no cause, so a carrier 503 read
    // as "Could not issue a browser credential" and nothing else. A CommsError's
    // message is operator-readable by contract (no token, body or stack), and
    // its providerCode (TELNYX_HTTP_503) groups one outage as one issue.
    //
    // Only a CommsError gets that grouping. Any other error in this route (a
    // database failure, an adapter bug) keeps Sentry's default stack grouping:
    // sharing one fingerprint would fold a second, different bug into the first
    // issue, and the alert fires on a NEW issue, so nobody would be told.
    if (isCommsError(error)) {
      reportError(error, {
        source: "route:GET /api/comms/voice/token",
        tags: { vendor: error.providerCode?.split("_")[0]?.toLowerCase() },
        fingerprint: ["voice-token", error.providerCode ?? "comms"],
        extra: {
          providerCode: error.providerCode,
          kind: error.kind,
          httpStatus: error.httpStatus,
        },
      });
    } else {
      reportError(error, { source: "route:GET /api/comms/voice/token" });
    }
    return errorResponse(
      "The browser phone couldn't connect. It will try again shortly.",
      {
        code: "VOICE_TOKEN_FAILED",
        status: 502,
      },
    );
  }
}
