import {
  getCachedTradieCoordinationDashboard,
  getCachedTradies,
} from "@/lib/data/tradies";
import { createTradieSchedule } from "@/lib/data/tradieSchedules";
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
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "coordination") {
    const params = parseSearchParamsWithResponse(
      url,
      tradieCoordinationListQuerySchema,
    );
    if (!params.success) return params.response;

    const payload = await getCachedTradieCoordinationDashboard(params.data);
    return successResponse(payload);
  }

  const tradies = await getCachedTradies();
  return successResponse(tradies);
}
