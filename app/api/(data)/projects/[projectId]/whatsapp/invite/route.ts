import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/azureClient";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { findUserById } from "@/lib/domain/identity/users";
import {
  draftProjectWhatsAppInvite,
  sendProjectWhatsAppInvite,
} from "@/lib/domain/projects/whatsapp/invite";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  badRequestResponse,
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The email inviting a project's owners into its WhatsApp group.
 *
 * GET is the draft the office starts from; POST sends what they edited. The
 * recipients, the link and the once-only rule are the domain's
 * (lib/domain/projects/whatsapp/invite.ts).
 */

const sendSchema = z.object({
  recipients: z.array(z.string().trim().max(320)).min(1).max(10),
  subject: z.string().max(500),
  body: z.string().max(20_000),
});

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const draft = await draftProjectWhatsAppInvite(
      principal,
      { projectId },
      prisma,
    );
    return successResponse(draft);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Invite draft failed", error);
    return errorResponse("Could not prepare the invite.", {
      code: "PROJECT_WHATSAPP_INVITE_DRAFT_FAILED",
      status: 500,
    });
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return badRequestResponse(
      "An Idempotency-Key header is required so a retry cannot email the owners twice.",
    );
  }
  const parsed = await parseBodyWithResponse(request, sendSchema);
  if (!parsed.success) return parsed.response;

  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const user = await findUserById(principal.userId, prisma);
    const result = await sendProjectWhatsAppInvite(
      principal,
      {
        body: parsed.data.body,
        idempotencyKey,
        projectId,
        recipients: parsed.data.recipients,
        senderName: user?.name ?? "",
        subject: parsed.data.subject,
      },
      prisma,
      {
        fromAddress:
          process.env.BUSINESS_EMAIL ?? "info@royalconstructions.com.au",
        sendMail: (message) =>
          sendEmail({
            body: message.body,
            subject: message.subject,
            to: [...message.to],
          }),
      },
    );
    // The invite is on the project's email trail now.
    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Invite send failed", error);
    return errorResponse(
      "The invite could not be sent, and whether it went out is unknown. Check Sent Items before trying again.",
      { code: "PROJECT_WHATSAPP_INVITE_FAILED", status: 500 },
    );
  }
}
