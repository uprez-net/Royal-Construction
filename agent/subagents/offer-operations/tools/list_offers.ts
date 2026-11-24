import { defineTool } from "eve/tools";
import { listOffersInputSchema } from "@/agent/lib/offer-contracts";
import { listAuthorizedOffers } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "List active offers across the whole office, with no reference needed: by group (awaiting_client, awaiting_signature), by status, by recent change (a window of Sydney days), or only those due a follow-up with the client. Each row has the client, reference, status, when it was sent and last changed, and the follow-up state. Use this for briefs and any 'which offers…?' question; never search lead by lead.",
  inputSchema: listOffersInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  label: { start: () => "Load offers" },
  execute(input, ctx) {
    return listAuthorizedOffers(ctx, input);
  },
});
