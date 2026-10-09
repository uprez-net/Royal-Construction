import { auth } from "@clerk/nextjs/server";
import { head } from "@vercel/blob";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { getUserByClerkIdCached } from "@/lib/data/user";
import { completeProjectFileUpload } from "@/lib/domain/files";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";
import { parseBodyWithResponse } from "@/utils/validators/response";

const completionSchema = z.object({
  projectId: z.string().trim().min(1),
  milestoneId: z.string().trim().min(1).nullable().optional(),
  fileId: z.uuid(),
  // Preserve the original name: buildBlobPath sanitizes its spaces into dashes.
  fileName: z.string().min(1).max(255),
  fileUrl: z.url(),
});

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return unauthorizedResponse();
  const user = await getUserByClerkIdCached(userId);
  if (!user) return unauthorizedResponse();
  const body = await parseBodyWithResponse(request, completionSchema);
  if (!body.success) return body.response;

  try {
    const file = await completeProjectFileUpload(
      userPrincipal(user),
      body.data,
      prisma,
      head,
    );
    revalidateTag(`project-${body.data.projectId}`, CACHE_PROFILES.SHORT);
    return successResponse({ id: file.id, url: file.url });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to confirm project upload", error);
    return errorResponse(
      "Unable to save the uploaded file. Please try again.",
      { status: 500 },
    );
  }
}
