import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import type { OCRPageObject } from "@mistralai/mistralai/models/components";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { processPDFWithMistral } from "@/lib/ocr";
import { handleHbcfExtractionGeneration } from "@/lib/agent/hbcfExtractionAgent";
import {
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  errorResponse,
} from "@/utils/validators";

// OCR plus a model round-trip on a scanned certificate comfortably exceeds the
// default serverless budget on a slow scan.
export const maxDuration = 300;

const hbcfExtractBodySchema = z.object({
  url: z.url(),
  fileId: z.string().min(1),
  fileName: z.string().min(1),
});

// ---------------------------------------------------------------------------
// OCR page → markdown. Mirrors `lib/workflow/project.ts`, which keeps these
// helpers private to the workflow module; the shapes must stay in step so the
// HBCF agent sees the same page/table/image layout the tender agent does.
// ---------------------------------------------------------------------------

function normalizePageMarkdown(page: OCRPageObject, index: number) {
  let pageInfo = `\n\n--- PAGE ${index + 1} ---\n\n${page.markdown.trim()}\n\n`;
  pageInfo +=
    page.tables
      ?.map((table) => `\n\n--- TABLE ---\n\n${table.content.trim()}\n\n`)
      .join("") ?? "";
  pageInfo +=
    page.images
      ?.map((image) => `\n\n--- IMAGE ---\n\n${image.imageAnnotation ?? ""}\n\n`)
      .join("") ?? "";

  return pageInfo;
}

function pageBlocksToMarkdown(pages: OCRPageObject[]) {
  const pageArray = Array.isArray(pages) ? pages : pages ? [pages] : [];
  return pageArray
    .map((page, index) => normalizePageMarkdown(page, index))
    .join("\n");
}

/**
 * Reads the HBCF certificate number off an uploaded certificate.
 *
 * The number may legitimately come back blank — either the certificate does not
 * print one, or the model could not read it. The caller keeps the document
 * reference either way and leaves the red alert up until a number exists, so a
 * blank result is a 200, not an error.
 */
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

  const body = await parseBodyWithResponse(request, hbcfExtractBodySchema);
  if (!body.success) return body.response;

  const projectId = routeParams.data.projectId;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        customerId: true,
        siteManagerId: true,
        Lead: {
          select: {
            assignedId: true,
          },
        },
      },
    });

    if (!project) {
      return notFoundResponse("Project");
    }

    // Same edit gate as PATCH /api/projects/[projectId]: whoever may write the
    // number by hand may also have it read off a certificate.
    const canEditProject =
      user.role === Role.ADMIN ||
      project.siteManagerId === user.id ||
      project.Lead.assignedId === user.id ||
      (user.role === Role.CUSTOMER && user.customerId === project.customerId);

    if (!canEditProject) {
      return forbiddenResponse("You do not have access to update this project.");
    }

    const pages = await processPDFWithMistral(body.data.url);
    const markdown = pageBlocksToMarkdown(pages).trim();

    if (!markdown) {
      return successResponse({
        hbcfInsuranceNumber: "",
        fileId: body.data.fileId,
        fileName: body.data.fileName,
        url: body.data.url,
        ok: false,
        message:
          "No readable text was found in the uploaded document. Enter the number manually.",
      });
    }

    const extraction = await handleHbcfExtractionGeneration({ markdown });

    return successResponse({
      hbcfInsuranceNumber: extraction.hbcfInsuranceNumber,
      fileId: body.data.fileId,
      fileName: body.data.fileName,
      url: body.data.url,
      ok: extraction.ok,
      message: extraction.message,
    });
  } catch (error) {
    console.error(`/api/projects/${projectId}/hbcf-extract POST error`, error);
    return errorResponse("Failed to read the HBCF insurance document", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
