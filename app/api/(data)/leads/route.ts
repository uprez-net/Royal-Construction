import { badRequestResponse, createLeadSchema, errorResponse, leadLookupParamSchema, parseSearchParamsWithResponse, successResponse } from "@/utils/validators";
import { getLeads, createLead } from "@/lib/data/leads";
import { NextRequest } from "next/server";
import { parseLeadStageFilter } from "@/lib/leads/types";
import type { LeadStage as DBLeadStage } from "@prisma/client";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try {
    const params = parseSearchParamsWithResponse(url, leadLookupParamSchema);
    if (!params.success) return params.response;
    // An unknown label used to yield undefined, which getLeads strips out,
    // which drops the stage filter entirely and returns EVERY lead — a wrong
    // answer that looks like a working one. Retired labels (a bookmarked
    // ?status=Converted) resolve through a legacy alias; anything else is a
    // bad request.
    let statusFilterArray: DBLeadStage[] | undefined;
    if (params.data.status) {
      const { stages, unknown } = parseLeadStageFilter(params.data.status);
      if (unknown.length > 0) {
        return badRequestResponse(`Unknown lead stage filter: ${unknown.join(", ")}`);
      }
      statusFilterArray = stages;
    }
    const filterTiming = params.data.filterTiming;
    const filterLeadsWithoutProject = params.data.filterLeadsWithoutProject ? true : false;
    const isArchived = params.data.isArchived ? params.data.isArchived === 'true' : undefined;
    const pendingFollowUps = params.data.pendingFollowUps ? params.data.pendingFollowUps === 'true' : undefined;
    const upcomingFollowUps = params.data.upcomingFollowUps ? params.data.upcomingFollowUps === 'true' : undefined;
    const pendingMeetings = params.data.pendingMeetings ? params.data.pendingMeetings === 'true' : undefined;
    const upcomingMeetings = params.data.upcomingMeetings ? params.data.upcomingMeetings === 'true' : undefined;
    const leads = await getLeads(params.data.page, params.data.limit, params.data.q, statusFilterArray, filterTiming, filterLeadsWithoutProject, isArchived, pendingFollowUps, upcomingFollowUps, pendingMeetings, upcomingMeetings);
    return successResponse(leads);
  } catch (error) {
    console.error("/api/leads GET error", error);
    return errorResponse("Failed to fetch leads", {
      status: 500,
      code: "LEADS_FETCH_FAILED",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = createLeadSchema.safeParse(json);

    if (!parsed.success) {
      return badRequestResponse(parsed.error.message);
    }

    const created = await createLead(parsed.data);
    if ('message' in created) {
     // console.log("Lead already exists:", created.message);
      return successResponse(created, { status: 409 });
    }
    return successResponse(created, { status: 201 });
  } catch (error) {
    console.error("/api/leads POST error", error);
    return errorResponse("Failed to create lead", {
      status: 500,
      code: "LEAD_CREATE_FAILED",
    });
  }
}
