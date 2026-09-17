import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { resolveApprovalInputSchema } from "@/agent/lib/admin-contracts";
import { runAdminWrite } from "@/agent/lib/admin-operations";
import { adminOperations } from "@/agent/subagents/admin-operations/dependencies";

export default defineTool({
  description: "Approve or reject a pending admin approval request after reviewing it; rejection requires a reason and incident approvals require a resolution note.",
  inputSchema: resolveApprovalInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  async execute(input, ctx) {
    return await runAdminWrite({ action: "admin.approval.resolve", ctx, input, targetId: input.approvalId, targetType: "approval", execute: (tx) => adminOperations.resolveAuthorizedApproval(ctx, input, tx) });
  },
});
