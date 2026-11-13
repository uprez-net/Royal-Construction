import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { draftOfferHighlightsInputSchema } from "@/agent/lib/offer-contracts";
import { draftAuthorizedOfferHighlights } from "@/agent/lib/offer-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Draft reviewable selling highlights from one authorized offer schedule. It writes nothing and never claims the copy was accepted.",
  inputSchema: draftOfferHighlightsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  label: { start: () => "Draft offer highlights" },
  execute(input, ctx) {
    return draftAuthorizedOfferHighlights(ctx, input);
  },
});
