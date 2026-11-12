import { defineTool } from "eve/tools";
import { listOfferRevisionsInputSchema } from "@/agent/lib/offer-contracts";
import { offerOperations } from "@/agent/subagents/offer-operations/dependencies";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "List the bounded revision history for one exact authorized lead. Returns revision IDs and state versions so later work can target the correct row.",
  inputSchema: listOfferRevisionsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: () => "List offer revisions",
  },
  async execute(input, ctx) {
    return await offerOperations.listAuthorizedOfferRevisions(ctx, input);
  },
});
