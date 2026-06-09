import {
  tradieSearchQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";
import { getTradiesForLookup } from "@/lib/data/tradies";
import { connection, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  // Next.js 16 + Cache Components: force request-time execution for request URL usage.
  await connection();
  try {
    const params = parseSearchParamsWithResponse(request.nextUrl, tradieSearchQuerySchema);
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