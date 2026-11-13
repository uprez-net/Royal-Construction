import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateOfferDetailsInputSchema } from "@/agent/lib/offer-contracts";
import { updateAuthorizedOfferDetails } from "@/agent/lib/offer-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Update targeted sections of an exact active offer workspace using its current stateVersion. Supports job/site details, floor-area calculator, cost lines, allowances, exclusions, payment schedule, pricing, images, tender gate, and document draft content. The client's Offer document prints only draft.exclusionBullets; `exclusions` feed the Tender schedule only. Any exclusion change must set exclusionDocument to the document the user named (offer, tender or both) and touch only that document's list; if the user did not say, ask instead of choosing. A draft patch replaces each list it names, so send the whole list with existing lines kept. Write client-facing text exactly as the user gave it. Read details first and require owner approval.",
  inputSchema: updateOfferDetailsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ exclusionDocument, patch }) =>
      `Update offer ${Object.keys(patch).join(", ")}${exclusionDocument ? ` (${exclusionDocument} exclusions)` : ""}`,
  },
  execute(input, ctx) {
    return updateAuthorizedOfferDetails(ctx, input);
  },
});
