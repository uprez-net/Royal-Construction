import { refreshAgentContext } from "@/lib/domain/agent-context";
import { systemPrincipal } from "@/lib/domain/principal";
import { gatewayEmbedding } from "@/lib/embedding-port";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators";

/**
 * The nightly rebuild of the operations agent's office context.
 *
 * Every live lead, project and tradie is laid out as text (deterministically,
 * by lib/domain/agent-context/text.ts), re-embedded only where the text
 * changed, and the office digest is rewritten. Agent writes refresh their own
 * record during the day through /api/agent/effects; this run is what catches
 * everything changed on screen, by a webhook, or by another cron.
 *
 * An embedding outage is reported, not fatal: the text is still saved and the
 * agent can still find records by name until the next run embeds them.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return errorResponse("Cron not configured", {
      status: 500,
      code: "CONFIG_ERROR",
    });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", { status: 401, code: "UNAUTHORIZED" });
  }

  try {
    const result = await refreshAgentContext(
      systemPrincipal("cron:agent-context"),
      {},
      prisma,
      { embedding: gatewayEmbedding },
    );
    if (result.embeddingFailed) {
      console.error(
        "[CRON] agent-context: embeddings failed; records saved without vectors",
        result,
      );
    }
    return successResponse({ message: "Agent context refreshed.", ...result });
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("[CRON_ERROR] agent-context refresh failed:", error);
    return errorResponse("Failed to refresh agent context", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
