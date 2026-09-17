import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createTradieScheduleInputSchema } from "@/agent/lib/tradie-contracts";
import { createAuthorizedTradieSchedule, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Schedule one authorized tradie on a project milestone, rejecting overlapping active bookings, after owner approval.",
  inputSchema: createTradieScheduleInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.schedule.create", ctx, input, targetId: input.tradieId, targetType: "tradieSchedule", execute: () => createAuthorizedTradieSchedule(ctx, input) }); },
});
