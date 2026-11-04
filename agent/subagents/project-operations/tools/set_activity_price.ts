import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { setActivityPriceInputSchema } from "@/agent/lib/project-contracts";
import { setAuthorizedActivityPrice } from "@/agent/lib/project-operations";

export default defineTool({
  description:
    "Change one activity's quoted price on a project's profit and loss, using the milestoneId and current price (as expectedPrice) from get_project_financials. Dollars ex GST, before variations. A parent's price moves with its sub-activities; the stage price stays fixed to the contract. Administrators only; require owner approval.",
  inputSchema: setActivityPriceInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Reprice activity" },
  execute(input, ctx) {
    return setAuthorizedActivityPrice(ctx, input);
  },
});
