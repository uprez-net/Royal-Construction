import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { agentDb } from "@/agent/lib/db";
import { formatSydneyDateTime } from "@/lib/dates/sydney";
import { searchAgentContext } from "@/lib/domain/agent-context";
import { userPrincipal } from "@/lib/domain/principal";
import { gatewayEmbedding } from "@/lib/embedding-port";

/**
 * The orchestrator's memory of the business: find which lead, project or
 * tradie the office means from the way they said it, before delegating.
 *
 * Reads the AgentContextChunk index (lib/domain/agent-context) — deterministic
 * text from the CRM, ranked by embedding inner product plus a name match, and
 * filtered by the same scopes the screens use. Read-only and cheap, so the
 * orchestrator can run it on every request and hand specialists exact record
 * ids instead of letting each of them search.
 */
export default defineTool({
  description: [
    "Look up the office's snapshot of live leads, projects and tradies from a few words — a surname, a street, a suburb, a trade, a nickname, or a description like 'the double storey waiting on its CC'.",
    "Returns each match's snapshot (stage, offer, money, dates, milestones, compliance, bookings) and its record ids for tool calls.",
    "Use it first whenever a request names or describes a record, then pass the ids to the specialists. Never show the ids to people.",
    "Snapshot only (refreshed nightly and after every agent change): confirm live values through a specialist before acting or quoting a figure or date to a client.",
  ].join(" "),
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(500)
      .describe("The words the person used to describe the record(s)."),
    kinds: z
      .array(z.enum(["lead", "project", "tradie"]))
      .max(3)
      .optional()
      .describe("Limit to these record kinds. Omit to search all."),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  label: { start: () => "Checking what the office knows" },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    const hits = await searchAgentContext(
      userPrincipal(actor),
      input,
      agentDb,
      { embedding: gatewayEmbedding },
    );
    return {
      matches: hits.map((hit) => ({
        kind: hit.kind,
        relevance: Math.round(hit.score * 100) / 100,
        snapshot: hit.content,
        snapshotTakenAt: formatSydneyDateTime(hit.refreshedAt),
        title: hit.title,
      })),
      note: hits.length
        ? "Snapshot data. Refs lines are for tool calls only. If two matches fit equally, ask which one."
        : "Nothing in the snapshot matches. Ask a specialist to search live records, or ask the person for another detail.",
    };
  },
});
