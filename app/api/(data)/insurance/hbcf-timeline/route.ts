import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { getHbcfTimelineForLead } from "@/lib/data/insurance";
import {
  badRequestResponse,
  errorResponse,
  notFoundResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators";

/**
 * HBCF claim capacity for the lead detail card.
 *
 * Reads across every project's cover window, so it is gated on an authenticated
 * user even though the response itself carries only names, dates and amounts.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorizedResponse();
  }

  const leadId = Number(new URL(request.url).searchParams.get("leadId"));
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return badRequestResponse("A valid leadId is required.");
  }

  try {
    const timeline = await getHbcfTimelineForLead(leadId);
    if (!timeline) return notFoundResponse("Lead");

    return successResponse(timeline);
  } catch (error) {
    console.error("/api/insurance/hbcf-timeline GET error", error);
    return errorResponse("Failed to load HBCF claim timeline", {
      status: 500,
      code: "HBCF_TIMELINE_FAILED",
    });
  }
}
