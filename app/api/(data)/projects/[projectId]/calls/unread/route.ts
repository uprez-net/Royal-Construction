import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  countUnreadProjectCalls,
  markProjectCallsSeen,
} from "@/lib/domain/comms/calls/project";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The number beside the call icon on a project's Comms tab: inbound calls the
 * matcher filed here that nobody has opened (GET), and clearing it when
 * someone opens the project's Calls (POST). ADMIN only.
 */

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      unread: await countUnreadProjectCalls(principal, { projectId }, prisma),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to count a project's unread calls", error);
    return errorResponse("Could not count the project's new calls.", {
      code: "PROJECT_CALLS_UNREAD_FAILED",
      status: 500,
    });
  }
}

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse({
      marked: await markProjectCallsSeen(principal, { projectId }, prisma),
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[calls] Failed to mark a project's calls read", error);
    return errorResponse("Could not mark the calls read.", {
      code: "PROJECT_CALLS_READ_FAILED",
      status: 500,
    });
  }
}
