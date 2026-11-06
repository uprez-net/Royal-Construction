import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getProjectFinancialsInputSchema } from "@/agent/lib/project-contracts";
import { getAuthorizedProjectFinancials } from "@/agent/lib/project-operations";

export default defineTool({
  description:
    "Read a project's profit and loss — how the job is tracking: the quoted price to the client against what tradies quoted and have invoiced, profit to date and forecast at completion, per stage and per activity, with the activities losing money, over-invoiced or missing a quote. Ex GST. Administrators only.",
  inputSchema: getProjectFinancialsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) {
    return getAuthorizedProjectFinancials(ctx, input);
  },
});
