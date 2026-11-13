import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { getAuthorizedTradie } from "@/agent/lib/tradie-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Read one authorized tradie with bounded ratings, incidents, and schedule history.",
  inputSchema: getTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  async execute(input, ctx) {
    return await getAuthorizedTradie(ctx, input);
  },
});
