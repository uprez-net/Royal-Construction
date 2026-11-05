import type { NextRequest } from "next/server";

import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import {
  leadWhatsAppCallPermission,
  requestWhatsAppCallPermission,
} from "@/lib/domain/leads/whatsapp/call-permissions";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Whether this lead can be called on WhatsApp (GET), and asking them to allow
 * it (POST). POST needs an `Idempotency-Key`: Meta allows one request a day,
 * so a double click must not spend the next one.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await leadWhatsAppCallPermission(principal, { leadId }, prisma, {
        channel: whatsappChannelFromEnv(),
      }),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Failed to load call permission", error);
    return errorResponse("Could not check WhatsApp calling.", {
      code: "WHATSAPP_PERMISSION_FAILED",
      status: 500,
    });
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot ask twice.",
    );
  }
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(
      await requestWhatsAppCallPermission(
        principal,
        { idempotencyKey, leadId },
        prisma,
        {
          whatsapp: createWhatsAppPortFromEnv(),
        },
      ),
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp-calls] Permission request failed", error);
    return errorResponse("The request couldn't be sent.", {
      code: "WHATSAPP_PERMISSION_SEND_FAILED",
      status: 500,
    });
  }
}
