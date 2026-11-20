import { NextRequest } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/azureClient";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  getTradieProjectThread,
  replyOnTradieThread,
  TRADIE_REPLY_MAX_LENGTH,
} from "@/lib/domain/tradies/emails";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  successResponse,
} from "@/utils/validators";

const paramsSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required"),
  tradieId: z.string().trim().min(1, "Tradie ID is required"),
});

const replySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a message before sending.")
    .max(TRADIE_REPLY_MAX_LENGTH),
  /** The browser's key for this attempt; held until a send succeeds. */
  attemptKey: z.string().trim().min(1).max(200),
});

type RouteContext = {
  params: Promise<{ projectId: string; tradieId: string }>;
};

/** One tradie's email thread on one project, oldest first. */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const routeParams = parseRouteParamsWithResponse(await params, paramsSchema);
  if (!routeParams.success) return routeParams.response;
  const { projectId, tradieId } = routeParams.data;

  try {
    const thread = await getTradieProjectThread(
      await currentPrincipal(),
      { projectId, tradieId },
      prisma,
    );
    return successResponse(thread);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      `GET /api/projects/${projectId}/tradies/${tradieId}/emails`,
      error,
    );
    return errorResponse("Could not load the emails with this tradie.", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

/** Send a message on the thread. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const routeParams = parseRouteParamsWithResponse(await params, paramsSchema);
  if (!routeParams.success) return routeParams.response;
  const body = await parseBodyWithResponse(request, replySchema);
  if (!body.success) return body.response;
  const { projectId, tradieId } = routeParams.data;

  try {
    const result = await replyOnTradieThread(
      await currentPrincipal(),
      {
        attemptKey: body.data.attemptKey,
        body: body.data.body,
        projectId,
        tradieId,
      },
      prisma,
      (message) =>
        sendEmail({
          body: message.body,
          subject: message.subject,
          to: message.to,
        }),
    );
    return successResponse(result, { status: result.alreadySent ? 200 : 201 });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error(
      `POST /api/projects/${projectId}/tradies/${tradieId}/emails`,
      error,
    );
    return errorResponse("Could not send the email.", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
