import type { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { listLeadWhatsAppSummaries } from "@/lib/domain/leads/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { parseLeadIdsParam } from "@/utils/validators/lead-task";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The per-row WhatsApp summary for a page of the lead list (#333).
 *
 * One request per page — never one per row, and never the full threads: the
 * list shows an unread badge, the last message time and whether the service
 * window is open, and that is all it reads.
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
    const summaries = await listLeadWhatsAppSummaries(
      principal,
      { leadIds: parsed.leadIds },
      prisma,
    );
    return successResponse(summaries);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to load lead summaries", error);
    return errorResponse("Could not load WhatsApp summaries.", {
      code: "WHATSAPP_SUMMARY_FAILED",
      status: 500,
    });
  }
}
