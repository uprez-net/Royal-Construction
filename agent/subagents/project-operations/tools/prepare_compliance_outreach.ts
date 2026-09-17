import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { prepareComplianceOutreachInputSchema } from "@/agent/lib/project-contracts";
import { prepareAuthorizedComplianceOutreach } from "@/agent/lib/project-operations";

export default defineTool({
  description:
    "Prepare a reviewable compliance party outreach or SLA-alert follow-up card with recipient, reference subject, body draft, attachment count, open-alert age, and a send action. Do not send until the user reviews and approves.",
  inputSchema: prepareComplianceOutreachInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) {
    return prepareAuthorizedComplianceOutreach(ctx, input);
  },
});
