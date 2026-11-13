import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { changeLeadTaskStateInputSchema } from "@/agent/lib/lead-contracts";
import {
  reopenAuthorizedLeadTask,
  authorizeLeadTaskMutation,
  resolveAuthorizedTask,
} from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Reopen an exact completed task on an authorized lead. Always require owner approval before writing.",
  inputSchema: changeLeadTaskStateInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: () => "Reopen lead task",
  },
  async execute({ taskId }, ctx) {
    const { actor, leadId } = await resolveAuthorizedTask(ctx, taskId);
    return runAuditedAgentOperation({
      action: "lead.task.reopen",
      ctx,
      inputSummary: { leadId, taskId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(taskId),
      targetType: "leadTask",
      authorize: (tx) => authorizeLeadTaskMutation(ctx, leadId, tx, taskId),
      execute: (tx) => reopenAuthorizedLeadTask(ctx, leadId, taskId, tx),
    });
  },
});
