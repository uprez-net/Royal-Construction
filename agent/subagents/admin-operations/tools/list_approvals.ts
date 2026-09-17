import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listApprovalsInputSchema } from "@/agent/lib/admin-contracts";
import { listAuthorizedApprovals } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "List the authenticated administrator's approval queue with safe summaries.",
  inputSchema: listApprovalsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return listAuthorizedApprovals(ctx, input); },
});
