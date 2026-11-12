import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { startOfferInputSchema } from "@/agent/lib/offer-contracts";
import { startAuthorizedOffer } from "@/agent/lib/offer-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Start the first offer for one exact authorized lead, from the admin defaults, with Job setup filled from the lead unless prefillFromLead is false. If the lead already has an offer, it is named and nothing changes. Nothing reaches the client. Name the lead for owner approval.",
  inputSchema: startOfferInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Start offer" },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "offer.start",
      ctx,
      inputSummary: {
        leadId: input.leadId,
        prefillFromLead: input.prefillFromLead,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetType: "offer",
      targetIdFromOutput: (output) => output.entityRef?.id,
      // Opening the offer takes its own transaction for the reference, and
      // the lead prefill is a model call.
      transactional: false,
      execute: () => startAuthorizedOffer(ctx, input),
    });
  },
});
