import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { sendComplianceFollowUpInputSchema } from "@/agent/lib/project-contracts";
import { sendAuthorizedComplianceFollowUp } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Send a reviewed follow-up for an open SLA compliance alert on the correct party thread and stamp lastFollowUpAt without resolving the alert. Require owner approval.",
  inputSchema: sendComplianceFollowUpInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: () => "Send SLA follow-up" },
  execute(input, ctx) {
    return sendAuthorizedComplianceFollowUp(ctx, input);
  },
});
