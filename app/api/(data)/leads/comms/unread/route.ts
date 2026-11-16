import type { NextRequest } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listLeadCommsUnread } from "@/lib/domain/comms/unread";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { parseLeadIdsParam } from "@/utils/validators/lead-task";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Unread calls (Mili or voicemail) and texts per lead, for the badge over the
 * call icon on a page of the lead list. One request per page, never per row.
 */
export async function GET(request: NextRequest) {
  const parsed = parseLeadIdsParam(request.nextUrl.searchParams.get("leadIds"));
  if (!parsed.ok) return badRequestResponse(parsed.error);
  if (parsed.leadIds === undefined) {
    return badRequestResponse("leadIds is required.");
  }
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await listLeadCommsUnread(principal, { leadIds: parsed.leadIds }, prisma),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Failed to load unread calls and texts", error);
    return errorResponse("Could not load unread calls and texts.", {
      code: "COMMS_UNREAD_FAILED",
      status: 500,
    });
  }
}
