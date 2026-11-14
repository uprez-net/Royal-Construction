import type { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import {
  getLeadWhatsAppThread,
  MAX_THREAD_PAGE,
} from "@/lib/domain/leads/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * One page of a lead's WhatsApp thread, with what may be sent next (#333).
 *
 * `?before=<messageId>` pages backwards; `?limit=` caps the page. The domain
 * owns the read, its scope and the eligibility answer the composer shows —
 * this only authenticates and shapes the request. Dates cross as ISO strings.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");

  const params = request.nextUrl.searchParams;
  const before = params.get("before")?.trim() || null;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (
    limit !== undefined
    && (!Number.isInteger(limit) || limit < 1 || limit > MAX_THREAD_PAGE)
  ) {
    return badRequestResponse(
      `limit must be a whole number between 1 and ${MAX_THREAD_PAGE}.`,
    );
  }

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();

    const thread = await getLeadWhatsAppThread(
      principal,
      { before, leadId, limit },
      prisma,
      { channel: whatsappChannelFromEnv() },
    );
    return successResponse(thread);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to load a lead thread", error);
    return errorResponse("Could not load the WhatsApp conversation.", {
      code: "WHATSAPP_THREAD_FAILED",
      status: 500,
    });
  }
}
