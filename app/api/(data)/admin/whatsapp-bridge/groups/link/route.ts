import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { linkProjectWhatsAppGroup } from "@/lib/domain/projects/whatsapp/groups";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

const schema = z.object({
  groupJid: z
    .string()
    .trim()
    .regex(/^[0-9-]{5,40}@g\.us$/, "Choose a group to link."),
  projectId: z.string().trim().min(1, "Choose a project.").max(100),
});

/** Link a group to a project, from Admin › WhatsApp bridge. */
export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, schema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await linkProjectWhatsAppGroup(
      principal,
      parsed.data,
      prisma,
      {
        bridge: createWhatsAppBridgePortFromEnv(),
      },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      "[whatsapp-bridge] The WhatsApp group could not be linked.",
      error,
    );
    return errorResponse("The WhatsApp group could not be linked.", {
      code: "WHATSAPP_BRIDGE_LINK_FAILED",
      status: 500,
    });
  }
}
