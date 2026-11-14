import type { NextRequest } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { sendLeadWhatsAppMessage } from "@/lib/domain/leads/whatsapp/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

// Shape only. Length, emptiness, template approval and every business rule
// are the domain's to refuse, with the sentence the operator reads.
const sendBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    body: z.string().max(10_000),
    businessPhoneNumberId: z.string().trim().max(64).nullish(),
  }),
  z.object({
    kind: z.literal("template"),
    templateName: z.string().trim().min(1).max(200),
    parameters: z.array(z.string().max(1_000)).max(20),
    businessPhoneNumberId: z.string().trim().max(64).nullish(),
  }),
]);

/**
 * Send one WhatsApp message to a lead's primary phone (#333).
 *
 * The `Idempotency-Key` header is required, not optional: the modal mints one
 * per composed message and keeps it until the send succeeds, so a double
 * click or a retry after a timeout is the same intent. There is no derived
 * fallback — a derived key is how a deliberate second follow-up was once
 * reported as sent while nothing went out.
 *
 * `alreadySent: true` means this key had already sent and nothing went out
 * now; the screen says so rather than claiming a fresh send.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot message the customer twice.",
    );
  }

  const parsed = await parseBodyWithResponse(request, sendBodySchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();

    const result = await sendLeadWhatsAppMessage(
      principal,
      {
        businessPhoneNumberId: body.businessPhoneNumberId ?? null,
        idempotencyKey,
        leadId,
        message:
          body.kind === "text"
            ? { body: body.body, kind: "text" }
            : {
                kind: "template",
                parameters: body.parameters,
                templateName: body.templateName,
              },
      },
      prisma,
      { whatsapp: createWhatsAppPortFromEnv() },
    );
    return successResponse(result);
  } catch (error) {
    // Refusals (window closed, no consent, archived) and provider failures
    // ("Nothing was sent: …", "didn't confirm…") both arrive here as domain
    // errors carrying the sentence the operator needs.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Send failed unexpectedly", error);
    return errorResponse(
      "The message could not be sent, and its outcome is unknown. Reload the conversation before trying again.",
      { code: "WHATSAPP_SEND_FAILED", status: 500 },
    );
  }
}
