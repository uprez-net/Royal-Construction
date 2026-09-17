import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { sendComplianceOutreachInputSchema } from "@/agent/lib/project-contracts";
import { sendAuthorizedComplianceOutreach } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Send a reviewed opening compliance outreach to a party, resolving only project-scoped attachment IDs and recording the thread. Require owner approval.",
  inputSchema: sendComplianceOutreachInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ party }) => `Send ${party.toLowerCase().replaceAll("_", " ")} outreach` },
  execute(input, ctx) { return sendAuthorizedComplianceOutreach(ctx, input); },
});
