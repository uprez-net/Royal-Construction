import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { createProjectFromOfferInputSchema } from "@/agent/lib/offer-contracts";
import { createAuthorizedProjectFromOffer } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Hand one exact authorized Contract-signed offer over to a new project: the project, its milestones and the executed Tender and Contract PDFs, with the caller as site manager and the start date 14 days out. The offer becomes Project and cannot go back. Show the offer, client and price for owner approval.",
  inputSchema: createProjectFromOfferInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: () => "Create project from offer" },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "offer.project.handoff",
      ctx,
      inputSummary: { offerId: input.offerId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: input.offerId,
      targetType: "offer",
      // Fetching an executed PDF from DocuSign and the project transaction
      // cannot share one outer transaction.
      transactional: false,
      execute: () => createAuthorizedProjectFromOffer(ctx, input),
    });
  },
});
