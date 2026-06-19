import { badRequestResponse, createLeadSchema, errorResponse, leadLookupParamSchema, parseSearchParamsWithResponse, successResponse } from "@/utils/validators";
import { getLeads, createLead } from "@/lib/data/leads";
import { NextRequest } from "next/server";
import { LeadStage, LeadStageToLeadStageDBMapping } from "@/lib/leads/types";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try {
    const params = parseSearchParamsWithResponse(url, leadLookupParamSchema);
    if (!params.success) return params.response;
    const statusFilterArray = params.data.status ? params.data.status.split(',').map(s => LeadStageToLeadStageDBMapping[(s.trim() as LeadStage)]) : undefined;
    const filterTiming = params.data.filterTiming;
    const leads = await getLeads(params.data.page, params.data.limit, params.data.q, statusFilterArray, filterTiming);
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
