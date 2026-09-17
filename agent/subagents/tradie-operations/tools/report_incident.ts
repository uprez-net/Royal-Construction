import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { reportTradieIncidentInputSchema } from "@/agent/lib/tradie-contracts";
import {
  authorizeTradieWrite,
  reportAuthorizedTradieIncident,
  runTradieWrite,
} from "@/agent/lib/tradie-operations";

export default defineTool({
  description:
    "Record a tradie incident and queue its resolution for review after owner approval.",
  inputSchema: reportTradieIncidentInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  async execute(input, ctx) {
    return await runTradieWrite({
      action: "tradie.incident.report",
      ctx,
      input,
      targetId: input.tradieId,
      targetType: "tradie",
      authorize: (tx) =>
        authorizeTradieWrite(ctx, "tradie.incident.report", input, tx),
      execute: (tx) => reportAuthorizedTradieIncident(ctx, input, tx),
    });
  },
});
