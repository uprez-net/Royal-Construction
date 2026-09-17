import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateOfferDetailsInputSchema } from "@/agent/lib/offer-contracts";
import { updateAuthorizedOfferDetails } from "@/agent/lib/offer-operations";

export default defineTool({
  description:
    "Update targeted sections of an exact active offer workspace using its current stateVersion. Supports job/site details, floor-area calculator, cost lines, allowances, exclusions, payment schedule, pricing, images, tender gate, and document draft content. Read details first and require owner approval.",
  inputSchema: updateOfferDetailsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ patch }) => `Update offer ${Object.keys(patch).join(", ")}`,
  },
  execute(input, ctx) {
    return updateAuthorizedOfferDetails(ctx, input);
  },
});
