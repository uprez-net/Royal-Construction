import {
  tradieSearchQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";
import { getTradiesForLookup } from "@/lib/data/tradies";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = parseSearchParamsWithResponse(url, tradieSearchQuerySchema);
    if (!params.success) return params.response;

    const search = params.data.search || params.data.q || "";
    const limit = params.data.limit;

    const tradies = await getTradiesForLookup(limit, search);

    return successResponse(tradies);
  } catch (error) {
    console.error("/api/tradies GET error", error);
    return errorResponse("Failed to fetch tradies", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}