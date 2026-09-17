import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { requestTradiePriceChangeInputSchema } from "@/agent/lib/tradie-contracts";
import { requestAuthorizedTradiePriceChange, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Submit one tradie price change for the existing admin approval workflow.",
  inputSchema: requestTradiePriceChangeInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.price-change.request", ctx, input, targetId: input.tradieId, targetType: "tradie", execute: () => requestAuthorizedTradiePriceChange(ctx, input) }); },
});
