import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { sendOfferForSignatureInputSchema } from "@/agent/lib/offer-contracts";
import { sendAuthorizedOfferForSignature } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

const DOCUMENT_LABEL = {
  contract: "Contract",
  offer: "offer acceptance",
  tender: "Tender",
} as const;

export default defineTool({
  description:
    "Send one document of one exact authorized live offer to the client for DocuSign signature: 'offer' (acceptance, from Sent), 'tender' (from Agreed or Tender draft), or 'contract' (from Contract draft). The client receives a signing link. Never resend after an 'outcome unknown' or 'do not resend' result. Show the document, the offer reference and the price for owner approval.",
  inputSchema: sendOfferForSignatureInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ document }) => `Send ${DOCUMENT_LABEL[document]} for signature`,
  },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: `offer.${input.document}.envelope.send`,
      ctx,
      inputSummary: { document: input.document, offerId: input.offerId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: input.offerId,
      targetType: "offer",
      // A PDF render and a DocuSign call cannot run inside a transaction.
      transactional: false,
      execute: () => sendAuthorizedOfferForSignature(ctx, input),
    });
  },
});
