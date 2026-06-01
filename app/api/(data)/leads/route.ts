import { badRequestResponse, createLeadSchema, errorResponse, leadLookupParamSchema, parseSearchParamsWithResponse, successResponse } from "@/utils/validators";
import { getLeads, createLead } from "@/lib/data/leads";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try {
    const params = parseSearchParamsWithResponse(url, leadLookupParamSchema);
    if (!params.success) return params.response;
    const leads = await getLeads();
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
    return successResponse(created, { status: 201 });
  } catch (error) {
    console.error("/api/leads POST error", error);
    return errorResponse("Failed to create lead", {
      status: 500,
      code: "LEAD_CREATE_FAILED",
    });
  }
}
