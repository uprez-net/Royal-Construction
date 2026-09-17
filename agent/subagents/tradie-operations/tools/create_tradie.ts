import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { authorizeTradieWrite, createAuthorizedTradie, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Create a tradie directory record after showing all supplied details and receiving owner approval.",
  inputSchema: createTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.create", ctx, input, targetType: "tradie", targetIdFromOutput: (output) => typeof output.data.tradie === "object" && output.data.tradie !== null && "id" in output.data.tradie && typeof output.data.tradie.id === "string" ? output.data.tradie.id : undefined, authorize: (tx) => authorizeTradieWrite(ctx, "tradie.create", input, tx), execute: (tx) => createAuthorizedTradie(ctx, input, tx) }); },
});
