import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateMilestonesInputSchema } from "@/agent/lib/project-contracts";
import { updateAuthorizedMilestones } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

// One approval for "move these milestones". Several `update_milestone` calls in
// one step are several approvals, and eve runs none of them until every one is
// answered (#616).
export default defineTool({
  description:
    "Update two or more milestones on ONE project in a single call: one owner approval and all or nothing. Each entry takes exactly the fields of update_milestone and follows the same PENDING/ACTIVE/DONE/NOT_REQUIRED rules. Use this, not several update_milestone calls, whenever a request changes more than one milestone. Require owner approval.",
  inputSchema: updateMilestonesInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ updates }) =>
      `Update ${Array.isArray(updates) ? updates.length : "several"} milestones`,
  },
  execute(input, ctx) {
    return updateAuthorizedMilestones(ctx, input);
  },
});
