import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { searchTradiesInputSchema } from "@/agent/lib/tradie-contracts";
import { searchAuthorizedTradies } from "@/agent/lib/tradie-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Search the current caller's authorized Royal Construction tradie directory.",
  inputSchema: searchTradiesInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  execute(input, ctx) {
    return searchAuthorizedTradies(ctx, input);
  },
});
