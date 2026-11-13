import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { logOfferChangeRequestInputSchema } from "@/agent/lib/offer-contracts";
import { logAuthorizedOfferChangeRequest } from "@/agent/lib/offer-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Record a customer's bounded change request on the active offer activity timeline; require owner approval because this writes CRM history.",
  inputSchema: logOfferChangeRequestInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: () => "Log change request" },
  execute(input, ctx) {
    return logAuthorizedOfferChangeRequest(ctx, input);
  },
});
