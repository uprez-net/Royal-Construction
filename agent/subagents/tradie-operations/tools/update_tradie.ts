import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { authorizeTradieWrite, runTradieWrite, updateAuthorizedTradie } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Update allowlisted tradie contact and directory fields after owner approval.",
  inputSchema: updateTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.update", ctx, input, targetId: input.tradieId, targetType: "tradie", authorize: (tx) => authorizeTradieWrite(ctx, "tradie.update", input, tx), execute: (tx) => updateAuthorizedTradie(ctx, input, tx) }); },
});
