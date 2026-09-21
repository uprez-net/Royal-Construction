import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { draftOfferHighlightsInputSchema } from "@/agent/lib/offer-contracts";
import { draftAuthorizedOfferHighlights } from "@/agent/lib/offer-operations";

export default defineTool({
  description:
    "Draft reviewable selling highlights from one authorized offer schedule. It writes nothing and never claims the copy was accepted.",
  inputSchema: draftOfferHighlightsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: { start: ({ leadId }) => `Draft offer highlights for lead ${leadId}` },
  execute(input, ctx) {
    return draftAuthorizedOfferHighlights(ctx, input);
  },
});
