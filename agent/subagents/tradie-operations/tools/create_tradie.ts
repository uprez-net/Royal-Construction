import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { createAuthorizedTradie, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Create a tradie directory record after showing all supplied details and receiving owner approval.",
  inputSchema: createTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.create", ctx, input, targetType: "tradie", execute: (tx) => createAuthorizedTradie(ctx, input, tx) }); },
});
