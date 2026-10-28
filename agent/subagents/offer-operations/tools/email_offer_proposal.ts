import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { emailOfferProposalInputSchema } from "@/agent/lib/offer-contracts";
import { emailAuthorizedOfferProposal } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Email the Offer document PDF for one exact authorized live offer to every customer signatory on it, and mark the offer Sent, which freezes its internal price inputs (Job setup, Cost schedule, Pricing) while the customer-facing Offer document and Scope stay editable through negotiation. The client receives it. Show the offer reference, the contract price and every recipient for owner approval.",
  inputSchema: emailOfferProposalInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Email offer to client" },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "offer.proposal.email",
      ctx,
      inputSummary: { offerId: input.offerId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: input.offerId,
      targetType: "offer",
      // A PDF render and a Graph send cannot run while holding a transaction.
      transactional: false,
      execute: () => emailAuthorizedOfferProposal(ctx, input),
    });
  },
});
