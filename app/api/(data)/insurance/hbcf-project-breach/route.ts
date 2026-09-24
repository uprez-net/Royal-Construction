import { auth } from "@clerk/nextjs/server";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { NextRequest } from "next/server";
import { getHbcfBreachForProject } from "@/lib/data/insurance";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators";

/**
 * Whether one project's cover window overruns the HBCF pool.
 *
 * `null` data is the success case, not a 404: the project exists, it simply has
 * nothing to warn about. Reserving 404 for a genuinely missing project would
 * mean the badge treated "all clear" as an error.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorizedResponse();
  }

  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) {
    return badRequestResponse("A valid projectId is required.");
  }

  try {
    return successResponse(await getHbcfBreachForProject(projectId));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error("/api/insurance/hbcf-project-breach GET error", error);
    return errorResponse("Failed to load HBCF capacity check", {
      status: 500,
      code: "HBCF_PROJECT_BREACH_FAILED",
    });
  }
}
