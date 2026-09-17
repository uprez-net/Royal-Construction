import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getAuthorizedXero } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Read safe Xero connection status; tokens and secrets are never returned.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: agentResultEnvelopeSchema,
  execute(_input, ctx) { return getAuthorizedXero(ctx); },
});
