import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { changeLeadTaskStateInputSchema } from "@/agent/lib/lead-contracts";
import {
  completeAuthorizedLeadTask,
  resolveAuthorizedTask,
} from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Mark an exact authorized lead task complete. This confirms the work happened, so always require owner approval.",
  inputSchema: changeLeadTaskStateInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ taskId }) => `Complete lead task ${taskId}`,
  },
  async execute({ taskId }, ctx) {
    const { actor, leadId } = await resolveAuthorizedTask(ctx, taskId);
    return runAuditedAgentOperation({
      action: "lead.task.complete",
      ctx,
      inputSummary: { leadId, taskId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(taskId),
      targetType: "leadTask",
      execute: () => completeAuthorizedLeadTask(ctx, leadId, taskId),
    });
  },
});
