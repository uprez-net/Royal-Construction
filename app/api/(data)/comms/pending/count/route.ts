import { connection } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { countPendingCommsUnread } from "@/lib/domain/comms/pending";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** The "Pending Calls/Messages" badge: unread items on the pending list. */
export async function GET() {
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      unread: await countPendingCommsUnread(principal, prisma),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[comms] Failed to count pending calls and messages", error);
    return errorResponse("Could not count pending calls and messages.", {
      code: "COMMS_PENDING_COUNT_FAILED",
      status: 500,
    });
  }
}
