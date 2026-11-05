import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { recordingLocation } from "@/lib/domain/comms/calls/recordings";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Play a stored call recording or voicemail. Staff only: the stored object's
 * path is unguessable and never appears in a list response, so this route
 * is the only way to reach it.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ recordingId: string }> },
) {
  const { recordingId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const location = await recordingLocation(
      principal,
      { recordingId },
      prisma,
    );
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store", Location: location.url },
      status: 302,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to open a recording", error);
    return errorResponse("Could not open the recording.", {
      code: "RECORDING_OPEN_FAILED",
      status: 500,
    });
  }
}
