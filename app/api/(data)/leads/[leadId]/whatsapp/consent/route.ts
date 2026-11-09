import type { NextRequest } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { recordLeadWhatsAppConsent } from "@/lib/domain/leads/whatsapp/consent";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const consentBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("grant"),
    source: z.enum(["VERBAL", "WRITTEN", "WEB_FORM", "CUSTOMER_INITIATED"]),
    note: z.string().max(2_000).nullish(),
  }),
  z.object({
    action: z.literal("opt_out"),
    note: z.string().max(2_000).nullish(),
  }),
]);

/**
 * Record how a lead agreed to WhatsApp contact, or that they opted out (#333).
 *
 * Staff only, and only ever from a person: the domain refuses anything that
 * is not a signed-in member of staff, which is also why Eve has no tool for it.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");

  const parsed = await parseBodyWithResponse(request, consentBodySchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const consent = await recordLeadWhatsAppConsent(
      principal,
      body.action === "grant"
        ? { action: "grant", leadId, note: body.note, source: body.source }
        : { action: "opt_out", leadId, note: body.note },
      prisma,
    );
    return successResponse(consent);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Failed to record consent", error);
    return errorResponse("Could not record WhatsApp consent.", {
      code: "WHATSAPP_CONSENT_FAILED",
      status: 500,
    });
  }
}
