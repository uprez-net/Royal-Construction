import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { sendSignedCopies } from "@/lib/data/compliance";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";

// Reading two signed documents back out of blob storage and pushing them
// through Graph is not a fast request.
export const maxDuration = 300;

/**
 * Sends the countersigned fee proposal and CDC form to the certifier.
 *
 * Idempotent in the data layer through a status-guarded transition, so the
 * client can fire this the moment the second copy lands without worrying about
 * a double submission producing two emails.
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
    const { engagement } = await requireComplianceAccess(projectId);
    const result = await sendSignedCopies(engagement!.id);
    return successResponse({ projectId, ...result });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    console.error("Failed to send the signed copies", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to send the signed copies to the certifier.",
      { status: 400, code: "SIGNED_COPY_SEND_FAILED" },
    );
  }
}
