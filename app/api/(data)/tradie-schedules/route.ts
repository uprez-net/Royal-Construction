import {
  getCachedTradieCoordinationDashboard,
  getCachedTradies,
} from "@/lib/data/tradies";
import { createTradieSchedule } from "@/lib/data/tradieSchedules";
import { requireStaffUser } from "@/lib/auth/require-internal-user";
import { currentPrincipal } from "@/lib/data/current-principal";
import { canSeeProjectFinancials } from "@/lib/domain/access/projects";
import { withoutTradieQuotes } from "@/lib/domain/projects/financial-redaction";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { reportError } from "@/lib/observability/report-error";
import {
  createTradieScheduleSchema,
  errorResponse,
  tradieCoordinationListQuerySchema,
  parseBodyWithResponse,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await parseBodyWithResponse(request, createTradieScheduleSchema);
  if (!body.success) return body.response;

  try {
    const schedule = await createTradieSchedule(body.data);
    return successResponse(schedule, { status: 201 });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    // Nothing else logs here, and the screen only sees a generic 500: without
    // this a failed booking reaches nobody.
    reportError(error, { source: "route:POST /api/tradie-schedules" });
    return errorResponse("Failed to create tradie schedule.", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export async function GET(request: Request) {
  // Every booking in the business, so staff only. A site manager works from
  // these lists (with the quotes taken out below), so this is the staff guard,
  // not the office one.
  const access = await requireStaffUser();
  if (!access.ok) {
    return errorResponse("Forbidden", { status: 403, code: "FORBIDDEN" });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "coordination") {
    const params = parseSearchParamsWithResponse(
      url,
      tradieCoordinationListQuerySchema,
    );
    if (!params.success) return params.response;

    // The cache is shared by every caller, so the quotes come out after it.
    const [payload, principal] = await Promise.all([
      getCachedTradieCoordinationDashboard(params.data),
      currentPrincipal(),
    ]);
    return successResponse(
      canSeeProjectFinancials(principal)
        ? payload
        : withoutTradieQuotes(payload),
    );
  }

  const [tradies, principal] = await Promise.all([
    getCachedTradies(),
    currentPrincipal(),
  ]);
  return successResponse(
    canSeeProjectFinancials(principal) ? tradies : withoutTradieQuotes(tradies),
  );
}
