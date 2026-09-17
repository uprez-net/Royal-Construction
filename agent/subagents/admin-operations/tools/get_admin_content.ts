import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getAuthorizedAdminContent } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Read the current versioned offer defaults used by new offers, including build scope, costs, inclusions, exclusions, and HBFC content.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: agentResultEnvelopeSchema,
  execute(_input, ctx) { return getAuthorizedAdminContent(ctx); },
});
