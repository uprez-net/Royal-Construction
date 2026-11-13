import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { prepareComplianceOutreachInputSchema } from "@/agent/lib/project-contracts";
import { prepareAuthorizedComplianceOutreach } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Prepare a reviewable compliance party outreach or SLA-alert follow-up card with recipient, reference subject, body draft, attachment count, open-alert age, and a send action. Lists the directoryContacts an opening outreach for that party may go to. Do not send until the user reviews and approves.",
  inputSchema: prepareComplianceOutreachInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  execute(input, ctx) {
    return prepareAuthorizedComplianceOutreach(ctx, input);
  },
});
