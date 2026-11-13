import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listApprovalsInputSchema } from "@/agent/lib/admin-contracts";
import { listAuthorizedApprovals } from "@/agent/lib/admin-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "List the authenticated administrator's approval queue with safe summaries.",
  inputSchema: listApprovalsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  async execute(input, ctx) {
    return await listAuthorizedApprovals(ctx, input);
  },
});
