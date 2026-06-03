import { errorResponse, successResponse } from "@/utils/validators";
import { getLeadsStats } from "@/lib/data/leads";

export async function GET() {
  try {
    const stats = await getLeadsStats();
    return successResponse(stats);
  } catch (error) {
    console.error("/api/leads/stats GET error", error);
    return errorResponse("Failed to fetch leads stats", {
      status: 500,
      code: "LEADS_STATS_FETCH_FAILED",
    });
  }
}
