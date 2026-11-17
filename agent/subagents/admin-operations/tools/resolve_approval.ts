import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { resolveApprovalInputSchema } from "@/agent/lib/admin-contracts";
import { runAdminWrite } from "@/agent/lib/admin-operations";
import {
  createAdminOperations,
  type AdminOperations,
} from "@/agent/subagents/admin-operations/dependencies";
import { forModel } from "@/agent/lib/model-output";

export function createResolveApprovalTool(operations: AdminOperations) {
  return defineTool({
    description:
      "Approve or reject a pending admin approval request after reviewing it; rejection requires a reason and incident approvals require a resolution note. Approving a tradie removal requires reviewedBookingIds: the ids of removalImpact.bookings from get_approval, after naming those bookings to the owner, because approval cancels every one.",
    inputSchema: resolveApprovalInputSchema,
    outputSchema: agentResultEnvelopeSchema,
    toModelOutput: forModel,
    approval: ownerOnlyApproval(),
    async execute(input, ctx) {
      return await runAdminWrite({
        action: "admin.approval.resolve",
        ctx,
        input,
        targetId: input.approvalId,
        targetType: "approval",
        execute: (tx) => operations.resolveAuthorizedApproval(ctx, input, tx),
      });
    },
  });
}

export default createResolveApprovalTool(createAdminOperations());
