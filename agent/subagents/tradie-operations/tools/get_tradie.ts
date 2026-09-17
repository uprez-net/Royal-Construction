import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { getAuthorizedTradie } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Read one authorized tradie with bounded ratings, incidents, and schedule history.",
  inputSchema: getTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return getAuthorizedTradie(ctx, input); },
});
