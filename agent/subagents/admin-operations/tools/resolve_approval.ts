import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { resolveApprovalInputSchema } from "@/agent/lib/admin-contracts";
import { resolveAuthorizedApproval, runAdminWrite } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Approve or reject a pending admin approval request after reviewing it; rejection requires a reason and incident approvals require a resolution note.",
  inputSchema: resolveApprovalInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runAdminWrite({ action: "admin.approval.resolve", ctx, input, targetId: input.approvalId, targetType: "approval", execute: () => resolveAuthorizedApproval(ctx, input) });
  },
});
