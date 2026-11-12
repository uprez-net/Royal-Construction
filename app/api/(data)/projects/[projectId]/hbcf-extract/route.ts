import { domainErrorResponse } from "@/lib/http/domain-response";
import { NextRequest } from "next/server";
import type { OCRPageObject } from "@mistralai/mistralai/models/components";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { authorizeProjectEdit } from "@/lib/domain/access/projects";
import { processPDFWithMistral } from "@/lib/ocr";
import { handleHbcfExtractionGeneration } from "@/lib/agent/hbcfExtractionAgent";
import {
  projectParamSchema,
  parseRouteParamsWithResponse,
  parseBodyWithResponse,
  successResponse,
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
      ?.map(
        (image) => `\n\n--- IMAGE ---\n\n${image.imageAnnotation ?? ""}\n\n`,
      )
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
 * Reads the HBCF certificate number, the cover start date and the amount
 * covered off an uploaded certificate. Nothing is saved here: the Overview tab offers the date to the
 * office to confirm, with the end of cover defaulted from it.
 *
 * Either may legitimately come back blank — the certificate does not
 * print one, or the model could not read it. The caller keeps the document
 * reference either way and leaves the red alert up until a number exists, so a
 * blank result is a 200, not an error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
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
    // The edit gate PATCH /api/projects/[projectId] uses, called rather than
    // copied: whoever may write the number by hand may have it read off a
    // certificate. The inline copy this replaces also let a CUSTOMER through,
    // which the PATCH it fed never did -- so they could spend an OCR run on a
    // save that was then refused.
    await authorizeProjectEdit(await currentPrincipal(), projectId, prisma);

    const pages = await processPDFWithMistral(body.data.url);
    const markdown = pageBlocksToMarkdown(pages).trim();

    if (!markdown) {
      return successResponse({
        hbcfInsuranceNumber: "",
        coverStartDate: "",
        claimAmount: null,
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
      coverStartDate: extraction.coverStartDate,
      claimAmount: extraction.claimAmount,
      fileId: body.data.fileId,
      fileName: body.data.fileName,
      url: body.data.url,
      ok: extraction.ok,
      message: extraction.message,
    });
  } catch (error) {
    // A domain refusal answers with its own status and its own message —
    // "You do not have access to this project." is what the operator needs,
    // and it is useless to them as an opaque 500.
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error(`/api/projects/${projectId}/hbcf-extract POST error`, error);
    return errorResponse("Failed to read the HBCF insurance document", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
