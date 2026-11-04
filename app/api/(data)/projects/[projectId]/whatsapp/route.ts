import { ProjectWhatsAppGroupStatus } from "@prisma/client";
import { after, type NextRequest } from "next/server";

import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { requestProjectWhatsAppGroup } from "@/lib/domain/projects/whatsapp/groups";
import { getProjectWhatsAppThread } from "@/lib/domain/projects/whatsapp/queries";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import {
  restartStalledProjectWhatsAppGroup,
  startProjectWhatsAppGroupWorkflow,
} from "@/lib/whatsapp/project-groups";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * A project's WhatsApp group: GET reads it (and a page of messages), POST
 * asks for one to be created. Rules: lib/domain/projects/whatsapp.
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
      { channel: whatsappChannelFromEnv() },
    );
    // A request Eve recorded, or one whose start failed, is started by the
    // first person to look at it.
    const group = thread.group;
    if (
      group?.status === ProjectWhatsAppGroupStatus.CREATING
      && !group.requestedAt
    ) {
      after(() => restartStalledProjectWhatsAppGroup(group.id));
    }
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

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await requestProjectWhatsAppGroup(
      principal,
      { projectId },
      prisma,
      { channel: whatsappChannelFromEnv() },
    );
    if (result.start) {
      try {
        await startProjectWhatsAppGroupWorkflow(result.group.id);
      } catch (error) {
        // The request is recorded; opening the project restarts it.
        console.error("[whatsapp] Could not start the group workflow", error);
      }
    }
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[whatsapp] Project group request failed", error);
    return errorResponse("The WhatsApp group could not be requested.", {
      code: "PROJECT_WHATSAPP_GROUP_FAILED",
      status: 500,
    });
  }
}
