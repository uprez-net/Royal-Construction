import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getAuthorizedAdminContent } from "@/agent/lib/admin-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Read the current versioned offer defaults used by new offers, including build scope, costs, inclusions, exclusions, and HBCF content.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  async execute(_input, ctx) {
    return await getAuthorizedAdminContent(ctx);
  },
});
