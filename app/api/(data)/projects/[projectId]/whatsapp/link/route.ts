import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  linkProjectWhatsAppGroup,
  listWhatsAppBridgeGroups,
  unlinkProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/groups";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Linking a project to one of the groups Royal's WhatsApp number is in.
 *
 * GET lists the groups no project has linked; POST links one; DELETE unlinks
 * the project's group (the group itself stays in WhatsApp).
 */

const linkSchema = z.object({
  groupJid: z
    .string()
    .trim()
    .regex(/^[0-9-]{5,40}@g\.us$/, "Choose a group to link."),
});

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const groups = await listWhatsAppBridgeGroups(principal, prisma, {
      bridge: createWhatsAppBridgePortFromEnv(),
    });
    return successResponse({
      groups: groups.filter((group) => !group.linkedProject),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Listing the bridge's groups failed", error);
    return errorResponse("Could not list the WhatsApp groups.", {
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
      { groupJid: parsed.data.groupJid, projectId },
      prisma,
      { bridge: createWhatsAppBridgePortFromEnv() },
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

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await unlinkProjectWhatsAppGroup(
      principal,
      { projectId },
      prisma,
      { bridge: createWhatsAppBridgePortFromEnv() },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Unlinking a group failed", error);
    return errorResponse("The WhatsApp group could not be unlinked.", {
      code: "PROJECT_WHATSAPP_UNLINK_FAILED",
      status: 500,
    });
  }
}
