import type { z } from "zod";
import type { searchLeadsInputSchema } from "@/agent/lib/lead-contracts";
import {
  agentResultEnvelopeSchema,
  displayName,
} from "@/agent/lib/result-contracts";
import type { SearchLeadsResult } from "@/lib/domain/leads/queries";
import { stageMap } from "@/types/lead";

// How Eve words a lead read. Split from lead-operations.ts, which reaches the
// mail and AI clients at import, so the paging arithmetic and the summary a
// caller reads can be tested without either.

export function leadReference(lead: {
  id: number;
  name: string;
  stage: keyof typeof stageMap;
}) {
  return {
    type: "lead" as const,
    id: String(lead.id),
    display: {
      label: displayName(lead.name, `Lead #${lead.id}`),
      secondaryText: stageMap[lead.stage],
      href: `/leads/${lead.id}`,
    },
  };
}

/** search_leads' envelope for one page of `searchLeads`. */
export function leadSearchEnvelope(
  input: z.infer<typeof searchLeadsInputSchema>,
  { items, totalCount, countsByStage }: SearchLeadsResult,
) {
  const query = input.query;
  const first = (input.page - 1) * input.limit + 1;
  const last = first + items.length - 1;
  const hasMore = last < totalCount;
  const noun = `authorized lead${totalCount === 1 ? "" : "s"}`;
  return agentResultEnvelopeSchema.parse({
    version: 1,
    kind: "entity-summary",
    title: query ? "Lead search results" : "Leads",
    // The total, never the page length: "10 leads" for page one of 57 is how
    // a caller came to believe the pipeline held ten.
    summary:
      items.length > 0
        ? `Showing ${first}–${last} of ${totalCount} ${noun}.${hasMore ? ` Ask for page ${input.page + 1} for more.` : ""}`
        : `No leads on page ${input.page}; ${totalCount} ${noun} matched in all.`,
    data: {
      leads: items.map((lead) => ({
        entityRef: leadReference(lead),
        archived: lead.isArchived,
        location: lead.location,
        projectTypes: lead.type,
        stage: stageMap[lead.stage],
        updatedAt: lead.updatedAt.toISOString(),
      })),
      query,
      stages: input.stages,
      page: input.page,
      limit: input.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / input.limit)),
      hasMore,
      nextPage: hasMore ? input.page + 1 : null,
      countsByStage: Object.fromEntries(
        Object.entries(countsByStage).map(([stage, count]) => [
          stageMap[stage as keyof typeof stageMap],
          count,
        ]),
      ),
    },
  });
}
