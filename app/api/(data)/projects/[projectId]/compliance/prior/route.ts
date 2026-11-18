import { NextRequest } from "next/server";
import { z } from "zod";

import { currentPrincipal } from "@/lib/data/current-principal";
import { recordPriorComplianceDocument } from "@/lib/data/compliance";
import { PRIOR_COMPLIANCE_DOCUMENT_TYPES } from "@/lib/domain/compliance/recorded-outside";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { idSchema } from "@/utils/validators/common";

/**
 * A file already uploaded, and which of the few kinds the section takes.
 *
 * Here rather than in `utils/validators/compliance.ts`: that barrel is
 * imported by routes all over the app, and giving it a domain import would
 * make every one of them a domain adapter in the error-surfacing guard's eyes.
 */
const priorComplianceDocumentSchema = z.object({
  fileId: idSchema,
  documentType: z.enum(PRIOR_COMPLIANCE_DOCUMENT_TYPES),
});

/**
 * Files one document of compliance done before the job came into the CRM —
 * the CDC or construction certificate, the HBCF certificate, the consent —
 * on a compliance file with no certifier, and moves the job to Active once
 * its certificate and HBCF cover are both held.
 *
 * The blob and its File row already exist (the client uploads first, as
 * everywhere else); this links them. Refused on a project whose certifier is
 * engaged here: its documents go on that file.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(
    request,
    priorComplianceDocumentSchema,
  );
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;

  try {
    const outcome = await recordPriorComplianceDocument(
      await currentPrincipal(),
      {
        projectId,
        documentType: body.data.documentType,
        fileId: body.data.fileId,
      },
    );
    return successResponse(
      {
        projectId,
        projectStatus: outcome.status,
        activated: outcome.activated,
        missing: outcome.missing,
      },
      { status: 201 },
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to record compliance done before the CRM", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to record the compliance document.",
    );
  }
}
