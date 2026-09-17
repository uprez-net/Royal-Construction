import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { checkOfferListsInputSchema } from "@/agent/lib/offer-contracts";
import { checkAuthorizedOfferLists } from "@/agent/lib/offer-operations";

export default defineTool({
  description: "Check bounded estimated, scheduled, excluded, and offered lists for one authorized lead. This produces review findings and writes nothing.",
  inputSchema: checkOfferListsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: { start: ({ leadId }) => `Check offer lists for lead ${leadId}` },
  execute(input, ctx) { return checkAuthorizedOfferLists(ctx, input); },
});
