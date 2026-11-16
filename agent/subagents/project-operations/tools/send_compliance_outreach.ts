import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { sendComplianceOutreachInputSchema } from "@/agent/lib/project-contracts";
import { sendAuthorizedComplianceOutreach } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Send a reviewed opening compliance outreach to a party, resolving only project-scoped attachment IDs and recording the thread. The recipient must be a tradie from prepare_compliance_outreach's directoryContacts for that party (pass its tradieId; contactEmail only to pick one of that tradie's own addresses), or a known developerKey for the estate developer. A consultant can be engaged only for a checklist line that asks for their work. The party's standard pack is attached automatically; pass the file ids from prepare_compliance_outreach's attachments as omitAttachmentIds to leave any off. Require owner approval.",
  inputSchema: sendComplianceOutreachInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ party }) =>
      `Send ${party.toLowerCase().replaceAll("_", " ")} outreach`,
  },
  execute(input, ctx) {
    return sendAuthorizedComplianceOutreach(ctx, input);
  },
});
