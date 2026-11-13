import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { recallOfferEnvelopeInputSchema } from "@/agent/lib/offer-contracts";
import { recallAuthorizedOfferEnvelope } from "@/agent/lib/offer-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Recall one exact offer, Tender, or Contract envelope. The server voids the live DocuSign envelope before changing status; require owner approval.",
  inputSchema: recallOfferEnvelopeInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: ({ scope }) => `Recall ${scope} envelope` },
  execute(input, ctx) {
    return recallAuthorizedOfferEnvelope(ctx, input);
  },
});
