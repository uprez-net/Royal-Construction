import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  linkProjectWhatsAppGroup,
  listLinkableWhatsAppGroups,
} from "@/lib/domain/projects/whatsapp/groups";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Linking an existing WhatsApp group to a project already underway.
 *
 * GET lists the business's own API-made groups no project has; POST links
 * one. A group made on a phone never appears — Meta's API cannot see it.
 */

const linkSchema = z.object({
  providerGroupId: z.string().trim().min(1).max(200),
});

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const groups = await listLinkableWhatsAppGroups(
      principal,
      { projectId },
      prisma,
      {
        channel: whatsappChannelFromEnv(),
        groups: createWhatsAppPortFromEnv()?.groups ?? null,
      },
    );
    return successResponse({ groups });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Listing linkable groups failed", error);
    return errorResponse("Could not list the business's WhatsApp groups.", {
      code: "PROJECT_WHATSAPP_LIST_FAILED",
      status: 500,
    });
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const parsed = await parseBodyWithResponse(request, linkSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await linkProjectWhatsAppGroup(
      principal,
      { projectId, providerGroupId: parsed.data.providerGroupId },
      prisma,
      {
        channel: whatsappChannelFromEnv(),
        groups: createWhatsAppPortFromEnv()?.groups ?? null,
      },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Linking a group failed", error);
    return errorResponse("The WhatsApp group could not be linked.", {
      code: "PROJECT_WHATSAPP_LINK_FAILED",
      status: 500,
    });
  }
}
