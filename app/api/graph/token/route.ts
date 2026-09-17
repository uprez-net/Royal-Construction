import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { requireAdminToken } from "@/lib/graph/route-utils";
import { successResponse, errorResponse } from "@/utils/validators";

// The local copy of requireAdminToken that used to live here failed open when
// GRAPH_ADMIN_TOKEN was unset. Use the shared guard, which fails closed.

export async function GET(request: Request): Promise<Response> {
  const config = getGraphConfig();
  const guard = requireAdminToken(request, config.adminToken);
  if (guard) {
    return guard;
  }

  try {
    const client = await createGraphContext(config);
    const tokenPreview = await client.getTokenPreview();
    return successResponse({ tokenPreview });
  } catch (error) {
    console.error("Graph token preview failed", error);
    return errorResponse("Failed to acquire token preview", {
      status: 500,
      code: "GRAPH_ERROR",
    });
  }
}
