import { randomUUID } from "crypto";
import { domainErrorResponse } from "@/lib/http/domain-response";

import { auth } from "@clerk/nextjs/server";
import { put } from "@/lib/blob";
import { getProjectById } from "@/lib/data/projects";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { createProjectUpdate } from "@/lib/data/projectUpdates";
import { authorizeProjectRecording } from "@/lib/domain/access/projects";
import { userPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import {
  createProjectUpdateSchema,
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorizedResponse();
  }

  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return unauthorizedResponse();
  }

  const resolvedParams = await params;
  const routeParams = parseRouteParamsWithResponse(
    resolvedParams,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const projectId = routeParams.data.projectId;
  const contentType = request.headers.get("content-type") ?? "";

  let notes = "";
  let milestoneId: string | null = null;
  let photoUrls: string[] = [];

  try {
    // The rule createProjectUpdate applies, asked before any photo is written
    // to public storage, so a refused caller leaves no object behind.
    await authorizeProjectRecording(userPrincipal(user), projectId, prisma);

    if (contentType.includes("application/json")) {
      const body = await parseBodyWithResponse(
        request,
        createProjectUpdateSchema,
      );
      if (!body.success) return body.response;

      notes = body.data.notes;
      milestoneId = body.data.milestoneId || null;
      photoUrls = body.data.photoUrls || [];
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      notes = String(formData.get("notes") ?? "").trim();
      const milestoneIdValue = formData.get("milestoneId");
      milestoneId =
        typeof milestoneIdValue === "string" && milestoneIdValue.length > 0
          ? milestoneIdValue
          : null;

      const files = formData
        .getAll("photos")
        .filter(
          (file): file is File =>
            file instanceof File
            && file.size > 0
            && file.size <= MAX_IMAGE_SIZE
            && ALLOWED_IMAGE_TYPES.includes(file.type),
        );

      if (
        files.length > 0
        && files.length !== formData.getAll("photos").length
      ) {
        return badRequestResponse(
          "Some files were rejected: invalid type or size > 10MB",
        );
      }

      photoUrls = await Promise.all(
        files.map(async (file) => {
          const blob = await put(
            `projects/${projectId}/${randomUUID()}-${file.name}`,
            file,
            {
              access: "public",
            },
          );
          return blob.url;
        }),
      );
    } else {
      return badRequestResponse(
        "Content-Type must be application/json or multipart/form-data",
      );
    }

    if (!notes || notes.trim().length === 0) {
      return badRequestResponse("Notes are required");
    }

    const { milestoneWasPhotoRequired } = await createProjectUpdate({
      projectId,
      milestoneId,
      notes,
      photoUrls,
    });

    if (milestoneWasPhotoRequired && milestoneId) {
      console.log(
        `[NOTIFICATION] Client notified for milestone ${milestoneId}`,
      );
    }

    const updatedProject = await getProjectById(projectId);

    if (!updatedProject) {
      return notFoundResponse("Project");
    }

    return successResponse(updatedProject, { status: 201 });
  } catch (error) {
    // A domain refusal answers with its own status and its own message —
    // "That milestone does not belong to this project." is what the operator
    // needs, and it is useless to them as an opaque 500.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error(`/api/projects/${projectId}/updates POST error`, error);
    return errorResponse("Failed to create project update", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
