import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { transitionOfferStatusInputSchema } from "@/agent/lib/offer-contracts";
import { transitionAuthorizedOfferStatus } from "@/agent/lib/offer-operations";

export default defineTool({
  description: "Move one exact authorized offer through an allowed lifecycle transition. Show the target status and note, then require owner approval.",
  inputSchema: transitionOfferStatusInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ toStatus }) => `Move offer to ${toStatus}` },
  execute(input, ctx) { return transitionAuthorizedOfferStatus(ctx, input); },
});
