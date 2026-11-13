import { auth } from "@clerk/nextjs/server";
import { del } from "@/lib/blob";
import { revalidateTag } from "next/cache";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { deleteProjectFile } from "@/lib/domain/projects/files";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; fileId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return unauthorizedResponse();
  const user = await getUserByClerkIdCached(userId);
  if (!user) return unauthorizedResponse();
  try {
    const result = await deleteProjectFile(
      userPrincipal(user),
      await params,
      prisma,
      async (urls) => {
        await del(typeof urls === "string" ? urls : [...urls]);
      },
    );
    revalidateTag(`project-${result.projectId}`, CACHE_PROFILES.SHORT);
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to delete project document", error);
    return errorResponse("Unable to delete the document. Please try again.", {
      status: 500,
    });
  }
}
