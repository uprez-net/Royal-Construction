import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateMilestoneInputSchema } from "@/agent/lib/project-contracts";
import { updateAuthorizedMilestone } from "@/agent/lib/project-operations";

export default defineTool({
  description:
    "Update one authorized milestone date, spend, or lifecycle status while enforcing the PENDING/ACTIVE/DONE/NOT_REQUIRED state machine. Require owner approval.",
  inputSchema: updateMilestoneInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ status }) => `Set milestone ${status}` },
  execute(input, ctx) {
    return updateAuthorizedMilestone(ctx, input);
  },
});
