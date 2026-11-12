import { defineTool } from "eve/tools";
import { getOfferInputSchema } from "@/agent/lib/offer-contracts";
import { getAuthorizedOffer } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Read one exact authorized offer revision by UUID, including status, amounts, timestamps, and state version. This never returns workspace or document bodies.",
  inputSchema: getOfferInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: () => "Load offer revision",
  },
  execute(input, ctx) {
    return getAuthorizedOffer(ctx, input);
  },
});
