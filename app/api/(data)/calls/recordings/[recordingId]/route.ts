import { readStoredBlob } from "@/lib/blob-port";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { recordingLocation } from "@/lib/domain/comms/calls/recordings";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Play a stored call recording or voicemail. Staff only. The audio is
 * streamed from here rather than redirected to, so the storage URL never
 * reaches a browser; this route is the only way to reach a recording.
 */
export async function GET(
  request: Request,
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
    const stored = await readStoredBlob(location.url, {
      range: request.headers.get("range"),
    });
    if (!stored) {
      return errorResponse("The recording file is missing.", {
        code: "RECORDING_MISSING",
        status: 404,
      });
    }
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Type": location.mimeType ?? stored.contentType,
    });
    if (stored.contentLength)
      headers.set("Content-Length", stored.contentLength);
    if (stored.contentRange) headers.set("Content-Range", stored.contentRange);
    if (stored.etag) headers.set("ETag", stored.etag);
    return new Response(stored.stream, {
      headers,
      status: stored.contentRange ? 206 : 200,
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
