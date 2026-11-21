import type { NextRequest } from "next/server";
import { z } from "zod";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { createProjectWhatsAppGroup } from "@/lib/domain/projects/whatsapp/groups";
import { getProjectWhatsAppThread } from "@/lib/domain/projects/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * A project's WhatsApp group: GET reads it (and a page of messages), POST
 * creates one on Royal's number through the WhatsApp bridge and links it.
 * Rules: lib/domain/projects/whatsapp.
 */

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? "");
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const thread = await getProjectWhatsAppThread(
      principal,
      {
        before: params.get("before"),
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
        projectId,
      },
      prisma,
      { bridge: createWhatsAppBridgePortFromEnv() },
    );
    return successResponse(thread);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Project group read failed", error);
    return errorResponse("Could not load the project's WhatsApp group.", {
      code: "PROJECT_WHATSAPP_READ_FAILED",
      status: 500,
    });
  }
}

const createSchema = z
  .object({
    /** After an unconfirmed create, the office checked: there is no group. */
    confirmNoGroup: z.boolean().optional(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  // The body is optional: a plain create sends none.
  const raw = await request.text();
  let confirmNoGroup = false;
  if (raw.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return badRequestResponse("The body must be JSON.");
    }
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) return badRequestResponse("Unexpected body.");
    confirmNoGroup = parsed.data.confirmNoGroup === true;
  }
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await createProjectWhatsAppGroup(
      principal,
      { confirmNoGroup, projectId },
      prisma,
      { bridge: createWhatsAppBridgePortFromEnv() },
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Project group create failed", error);
    return errorResponse(
      "The WhatsApp group could not be created, and whether it exists is unknown. Check Admin › WhatsApp bridge before trying again.",
      { code: "PROJECT_WHATSAPP_GROUP_FAILED", status: 500 },
    );
  }
}
