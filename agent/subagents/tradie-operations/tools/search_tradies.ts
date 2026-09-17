import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { searchTradiesInputSchema } from "@/agent/lib/tradie-contracts";
import { searchAuthorizedTradies } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Search the current caller's authorized Royal Construction tradie directory.",
  inputSchema: searchTradiesInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return searchAuthorizedTradies(ctx, input); },
});
