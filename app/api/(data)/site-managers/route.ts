import { getCachedSiteManagersForDropdown } from "@/lib/data/siteManagers";
import {
  siteManagerLookupQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
} from "@/utils/validators";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = parseSearchParamsWithResponse(url, siteManagerLookupQuerySchema);
  if (!params.success) return params.response;

  const result = await getCachedSiteManagersForDropdown(
    params.data.page,
    params.data.limit,
    params.data.q || params.data.search
  );
  return successResponse(result);
}