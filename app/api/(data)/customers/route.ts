import { getCachedCustomersForDropdown } from "@/lib/data/customers";
import {
  customerLookupQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = parseSearchParamsWithResponse(url, customerLookupQuerySchema);
  if (!params.success) return params.response;

  const result = await getCachedCustomersForDropdown(
    params.data.page,
    params.data.limit,
    params.data.q || params.data.search
  );
  return successResponse(result);
}