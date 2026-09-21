import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { saveContractParticularsInputSchema } from "@/agent/lib/offer-contracts";
import { saveAuthorizedContractParticulars } from "@/agent/lib/offer-operations";

export default defineTool({
  description:
    "Save bounded BC4 contract particulars on one exact active CONTRACT_DRAFT. These values are frozen into the legal envelope; require owner approval.",
  inputSchema: saveContractParticularsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Save contract particulars" },
  execute(input, ctx) {
    return saveAuthorizedContractParticulars(ctx, input);
  },
});
