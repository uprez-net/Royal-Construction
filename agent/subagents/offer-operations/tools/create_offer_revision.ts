import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createOfferRevisionInputSchema } from "@/agent/lib/offer-contracts";
import { createAuthorizedOfferRevision } from "@/agent/lib/offer-operations";

export default defineTool({
  description: "Create a new active offer revision from one exact authorized offer. Any live signature envelopes are voided first; require owner approval.",
  inputSchema: createOfferRevisionInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Create offer revision" },
  execute(input, ctx) { return createAuthorizedOfferRevision(ctx, input); },
});
