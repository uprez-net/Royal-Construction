import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { requestTradieRemovalInputSchema } from "@/agent/lib/tradie-contracts";
import {
  authorizeTradieWrite,
  requestAuthorizedTradieRemoval,
  runTradieWrite,
} from "@/agent/lib/tradie-operations";

export default defineTool({
  description:
    "Submit a tradie removal request for admin approval; never delete the record directly.",
  inputSchema: requestTradieRemovalInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runTradieWrite({
      action: "tradie.removal.request",
      ctx,
      input,
      targetId: input.tradieId,
      targetType: "tradie",
      authorize: (tx) =>
        authorizeTradieWrite(ctx, "tradie.removal.request", input, tx),
      execute: (tx) => requestAuthorizedTradieRemoval(ctx, input, tx),
    });
  },
});
