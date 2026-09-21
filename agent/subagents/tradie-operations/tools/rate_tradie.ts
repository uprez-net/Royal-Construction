import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { rateTradieInputSchema } from "@/agent/lib/tradie-contracts";
import {
  authorizeTradieWrite,
  rateAuthorizedTradie,
  runTradieWrite,
} from "@/agent/lib/tradie-operations";

export default defineTool({
  description:
    "Record a 0.5–5 tradie rating and optional comment after owner approval.",
  inputSchema: rateTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  async execute(input, ctx) {
    return await runTradieWrite({
      action: "tradie.rating.create",
      ctx,
      input,
      targetId: input.tradieId,
      targetType: "tradie",
      authorize: (tx) =>
        authorizeTradieWrite(ctx, "tradie.rating.create", input, tx),
      execute: (tx) => rateAuthorizedTradie(ctx, input, tx),
    });
  },
});
