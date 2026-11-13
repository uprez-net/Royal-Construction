import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { rescheduleTradieInputSchema } from "@/agent/lib/tradie-contracts";
import {
  authorizeTradieWrite,
  rescheduleAuthorizedTradie,
  runTradieWrite,
} from "@/agent/lib/tradie-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Move an authorized tradie booking to a new date, duration, or milestone after checking conflicts and owner approval. A date change puts the booking back to the tradie: an approved booking waits on their confirmation of the new date, anything else on their availability again (a pending admin approval for the old date is withdrawn). Declined, completed and removed bookings cannot be moved. This tool does not email the tradie.",
  inputSchema: rescheduleTradieInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runTradieWrite({
      action: "tradie.schedule.reschedule",
      ctx,
      input,
      targetId: input.scheduleId,
      targetType: "tradieSchedule",
      authorize: (tx) =>
        authorizeTradieWrite(ctx, "tradie.schedule.reschedule", input, tx),
      execute: (tx) => rescheduleAuthorizedTradie(ctx, input, tx),
    });
  },
});
