import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { unlinkProjectWhatsAppGroup } from "@/lib/domain/projects/whatsapp/group-links";
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
  /** The group the admin confirmed; refused if the project's group changed. */
  groupJid: z
    .string()
    .trim()
    .regex(/^[0-9-]{5,40}@g\.us$/),
  projectId: z.string().trim().min(1).max(100),
});

/** Take a project's group off it, from Admin › WhatsApp bridge. */
export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, schema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await unlinkProjectWhatsAppGroup(
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
      "[whatsapp-bridge] The WhatsApp group could not be unlinked.",
      error,
    );
    return errorResponse("The WhatsApp group could not be unlinked.", {
      code: "WHATSAPP_BRIDGE_UNLINK_FAILED",
      status: 500,
    });
  }
}
