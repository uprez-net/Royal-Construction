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
  async execute(input, ctx) { return await runTradieWrite({ action: "tradie.schedule.create", ctx, input, targetType: "tradieSchedule", targetIdFromOutput: (output) => typeof output.data.schedule === "object" && output.data.schedule !== null && "id" in output.data.schedule && typeof output.data.schedule.id === "string" ? output.data.schedule.id : undefined, execute: (tx) => createAuthorizedTradieSchedule(ctx, input, tx) }); },
});
