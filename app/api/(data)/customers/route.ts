import { getCachedCustomersForDropdown } from "@/lib/data/customers";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  customerLookupQuerySchema,
  errorResponse,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = parseSearchParamsWithResponse(url, customerLookupQuerySchema);
  if (!params.success) return params.response;

  try {
    const result = await getCachedCustomersForDropdown(
      params.data.page,
      params.data.limit,
      params.data.q || params.data.search,
    );
    return successResponse(result);
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Customer lookup failed", error);
    return errorResponse("Could not load customers.", { status: 500 });
  }
}
