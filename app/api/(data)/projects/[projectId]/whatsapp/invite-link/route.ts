import type { NextRequest } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { refreshProjectWhatsAppInviteLink } from "@/lib/domain/projects/whatsapp/group-links";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Ask WhatsApp for the project group's current invite link. */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const group = await refreshProjectWhatsAppInviteLink(
      principal,
      { projectId },
      prisma,
      { bridge: createWhatsAppBridgePortFromEnv() },
    );
    return successResponse({ group });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Refreshing the invite link failed", error);
    return errorResponse("Could not refresh the invite link.", {
      code: "PROJECT_WHATSAPP_INVITE_LINK_FAILED",
      status: 500,
    });
  }
}
