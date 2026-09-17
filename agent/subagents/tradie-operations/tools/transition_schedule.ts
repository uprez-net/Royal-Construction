import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { transitionTradieScheduleInputSchema } from "@/agent/lib/tradie-contracts";
import { runTradieWrite, transitionAuthorizedTradieSchedule } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Move one schedule through the allowed tradie booking state machine, optionally recording a quote, after owner approval.",
  inputSchema: transitionTradieScheduleInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.schedule.transition", ctx, input, targetId: input.scheduleId, targetType: "tradieSchedule", execute: (tx) => transitionAuthorizedTradieSchedule(ctx, input, tx) }); },
});
