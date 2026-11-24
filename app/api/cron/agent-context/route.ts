import { withCronReporting } from "@/lib/observability/cron";
import {
  refreshAgentContext,
  refreshAgentFiles,
} from "@/lib/domain/agent-context";
import { systemPrincipal } from "@/lib/domain/principal";
import { documentTextReader } from "@/lib/document-text-port";
import { gatewayEmbedding } from "@/lib/embedding-port";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators";

/**
 * The morning rebuild of the operations agent's office context, at 21:00 UTC:
 * 8 am in Sydney under daylight saving, 7 am outside it. Once a day is
 * enough; the CRM does not change much within a day.
 *
 * Every live lead, offer and project is laid out as section chunks, and every
 * tradie as one (deterministically, by lib/domain/agent-context/text.ts, with
 * keywords and tags), re-embedded only where a chunk changed, and the office
 * digest is rewritten. Agent writes refresh their own records during the day
 * through /api/agent/effects; this run is what catches everything changed on
 * screen, by a webhook, or by another cron. The response reports how long it
 * took and how many chunks were embedded and skipped.
 *
 * Then the uploaded documents filed under those records are read (OCR), cut
 * into passages tagged with their lead, project and offer, and embedded
 * (lib/domain/agent-context/files.ts). Reading is slow, so it stops starting
 * new documents with time to spare; what is left is read on the next run, and
 * running this again by hand drains a backlog sooner.
 *
 * An embedding outage is reported, not fatal: the text is still saved and the
 * agent can still find records by name until the next run embeds them.
 */
export const maxDuration = 300;

/** Leaves time to write and embed what was read before the function is stopped. */
const DOCUMENT_READ_BUDGET_MS = 200_000;

async function handle(request: Request) {
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

  const startedAt = Date.now();
  try {
    const principal = systemPrincipal("cron:agent-context");
    const result = await refreshAgentContext(principal, {}, prisma, {
      embedding: gatewayEmbedding,
    });
    if (result.embeddingFailed) {
      console.error(
        "[CRON] agent-context: embeddings failed; records saved without vectors",
        result,
      );
    }
    const documents = await refreshAgentFiles(
      principal,
      { deadline: new Date(startedAt + DOCUMENT_READ_BUDGET_MS) },
      prisma,
      { documentText: documentTextReader, embedding: gatewayEmbedding },
    );
    if (
      documents.embeddingFailed
      || documents.failed > 0
      || documents.readerUnavailable
    ) {
      console.error(
        "[CRON] agent-context: some documents were not read or embedded; the next run retries them",
        documents,
      );
    }
    return successResponse({
      message: "Agent context refreshed.",
      ...result,
      documents,
    });
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

export const GET = withCronReporting("/api/cron/agent-context", handle);
