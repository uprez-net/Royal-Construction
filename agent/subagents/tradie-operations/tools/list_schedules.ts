import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listTradieSchedulesInputSchema } from "@/agent/lib/tradie-contracts";
import { listAuthorizedTradieSchedules } from "@/agent/lib/tradie-operations";

export default defineTool({
  description:
    "List authorized tradie bookings, filtered by project, tradie, status, date window, or search text.",
  inputSchema: listTradieSchedulesInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  async execute(input, ctx) {
    return await listAuthorizedTradieSchedules(ctx, input);
  },
});
