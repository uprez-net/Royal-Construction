import { start } from "workflow/api";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { retryCallRecording } from "@/lib/domain/comms/calls/recordings";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { storeCallRecordings } from "@/lib/workflow/call-recording";
import { errorResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/** Try copying a failed recording again. */
export async function POST(_request: Request, ctx: { params: Promise<{ recordingId: string }> }) {
  const { recordingId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    await retryCallRecording(principal, { recordingId }, prisma);
    await start(storeCallRecordings, [[recordingId]]);
    return successResponse({ queued: true });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Recording retry failed", error);
    return errorResponse("Could not retry the recording.", { code: "RECORDING_RETRY_FAILED", status: 500 });
  }
}
