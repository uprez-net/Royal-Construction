import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { rescheduleTradieInputSchema } from "@/agent/lib/tradie-contracts";
import { authorizeTradieWrite, rescheduleAuthorizedTradie, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Move an authorized tradie booking to a new date, duration, or milestone after checking conflicts and owner approval.",
  inputSchema: rescheduleTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.schedule.reschedule", ctx, input, targetId: input.scheduleId, targetType: "tradieSchedule", authorize: (tx) => authorizeTradieWrite(ctx, "tradie.schedule.reschedule", input, tx), execute: (tx) => rescheduleAuthorizedTradie(ctx, input, tx) }); },
});
