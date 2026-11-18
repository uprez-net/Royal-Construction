import { NextRequest } from "next/server";

import { currentPrincipal } from "@/lib/data/current-principal";
import { activatePriorCompliance } from "@/lib/data/compliance";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

/**
 * Moves a job whose compliance was done before the CRM to Active, if its
 * certificate and HBCF cover are now both held. Files nothing.
 *
 * Called after the Overview tab saves an HBCF certificate: the project holding
 * it counts, so a job whose CDC was already recorded becomes Active on that
 * save. Refused on a project whose certifier is engaged here.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId } = routeParams.data;

  try {
    const outcome = await activatePriorCompliance(
      await currentPrincipal(),
      projectId,
    );
    return successResponse({
      projectId,
      projectStatus: outcome.status,
      activated: outcome.activated,
      missing: outcome.missing,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to activate a job with prior compliance", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to check the job's compliance.",
    );
  }
}
