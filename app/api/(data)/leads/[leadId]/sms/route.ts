import type { NextRequest } from "next/server";
import { z } from "zod";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  parsePositiveId,
  signedInUserPrincipal,
} from "@/lib/data/lead-whatsapp-request";
import { getLeadSmsThread } from "@/lib/domain/comms/sms/queries";
import { sendLeadSms } from "@/lib/domain/comms/sms/send";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * A lead's SMS thread (GET) and sending one text (POST).
 *
 * The domain (lib/domain/comms/sms) owns every rule: who may text, the
 * lead's own number, STOP, the sender. This authenticates and shapes.
 *
 * POST needs an `Idempotency-Key`: the composer mints one per message and
 * keeps it until the send succeeds, so a double click or a retry is the same
 * text. `alreadySent: true` means nothing went out this time.
 */

const sendBodySchema = z.object({ body: z.string().max(5_000) });

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ leadId: string }> },
) {
  const leadId = parsePositiveId((await ctx.params).leadId);
  if (leadId === null) return badRequestResponse("Invalid lead id.");
  const beforeRaw = request.nextUrl.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime()))
    return badRequestResponse("Invalid `before`.");
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const thread = await getLeadSmsThread(
      principal,
      { before, leadId },
      prisma,
      {
        channel: commsRuntimeFromEnv().channel,
      },
    );
    return successResponse(thread);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[sms] Failed to load a lead thread", error);
    return errorResponse("Could not load the SMS conversation.", {
      code: "SMS_THREAD_FAILED",
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
      "An Idempotency-Key header is required so a retry cannot text the customer twice.",
    );
  }
  const parsed = await parseBodyWithResponse(request, sendBodySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const runtime = commsRuntimeFromEnv();
    const result = await sendLeadSms(
      principal,
      { body: parsed.data.body, idempotencyKey, leadId },
      prisma,
      { channel: runtime.channel, sms: runtime.sms },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[sms] Send failed unexpectedly", error);
    return errorResponse(
      "The text could not be sent, and its outcome is unknown. Reload the conversation before trying again.",
      { code: "SMS_SEND_FAILED", status: 500 },
    );
  }
}
