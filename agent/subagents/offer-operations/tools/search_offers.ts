import { defineTool } from "eve/tools";
import { searchOffersInputSchema } from "@/agent/lib/offer-contracts";
import { searchAuthorizedOffers } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Search the current caller's authorized offer revisions by exact ID, reference, or lead name. Use this to resolve an offer before reading an exact revision.",
  inputSchema: searchOffersInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: ({ query }) => `Search offers for ${query}`,
  },
  execute(input, ctx) {
    return searchAuthorizedOffers(ctx, input);
  },
});
