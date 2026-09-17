import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { requestScheduleDeletionInputSchema } from "@/agent/lib/tradie-contracts";
import { requestAuthorizedScheduleDeletion, runTradieWrite } from "@/agent/lib/tradie-operations";

export default defineTool({
  description: "Request removal of a tradie booking through the admin approval queue; do not delete immediately.",
  inputSchema: requestScheduleDeletionInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) { return runTradieWrite({ action: "tradie.schedule.deletion.request", ctx, input, targetId: input.scheduleId, targetType: "tradieSchedule", execute: (tx) => requestAuthorizedScheduleDeletion(ctx, input, tx) }); },
});
