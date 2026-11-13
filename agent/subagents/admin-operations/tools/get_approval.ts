import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getApprovalInputSchema } from "@/agent/lib/admin-contracts";
import { getAuthorizedApproval } from "@/agent/lib/admin-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Inspect one approval request and its validated payload before deciding.",
  inputSchema: getApprovalInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  async execute(input, ctx) {
    return await getAuthorizedApproval(ctx, input);
  },
});
