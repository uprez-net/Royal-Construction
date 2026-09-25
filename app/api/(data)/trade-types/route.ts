import { connection } from "next/server";

import { getTradeTypes } from "@/lib/data/trade-types";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { errorResponse, successResponse } from "@/utils/validators";

/** The trades a tradie can be given. Read by useTradeTypes() for the pickers. */
export async function GET() {
  await connection();
  try {
    return successResponse(await getTradeTypes());
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("/api/trade-types GET error", error);
    return errorResponse("Couldn't load the trade list.", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
