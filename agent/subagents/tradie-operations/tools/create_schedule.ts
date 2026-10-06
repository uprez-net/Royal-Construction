import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createTradieScheduleInputSchema } from "@/agent/lib/tradie-contracts";
import {
  authorizeTradieWrite,
  createAuthorizedTradieSchedule,
  runTradieWrite,
} from "@/agent/lib/tradie-operations";

export default defineTool({
  description:
    "Schedule one authorized tradie on a project milestone, after owner approval. The tradie may already be booked on the same days for other work; booking the same tradie onto the same project milestone twice is rejected.",
  inputSchema: createTradieScheduleInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  async execute(input, ctx) {
    return await runTradieWrite({
      action: "tradie.schedule.create",
      ctx,
      input,
      targetType: "tradieSchedule",
      targetIdFromOutput: (output) =>
        typeof output.data.schedule === "object" &&
        output.data.schedule !== null &&
        "id" in output.data.schedule &&
        typeof output.data.schedule.id === "string"
          ? output.data.schedule.id
          : undefined,
      authorize: (tx) =>
        authorizeTradieWrite(ctx, "tradie.schedule.create", input, tx),
      execute: (tx) => createAuthorizedTradieSchedule(ctx, input, tx),
    });
  },
});
