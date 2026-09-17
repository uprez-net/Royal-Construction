import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { pollOfferSigningStatusInputSchema } from "@/agent/lib/offer-contracts";
import { getAuthorizedOfferSigningStatus } from "@/agent/lib/offer-operations";

export default defineTool({
  description:
    "Read the current authorized DocuSign signing status and bounded signer states for one exact offer revision.",
  inputSchema: pollOfferSigningStatusInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: { start: () => "Check offer signing status" },
  execute(input, ctx) {
    return getAuthorizedOfferSigningStatus(ctx, input);
  },
});
