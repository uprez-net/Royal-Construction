import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { createLeadTaskInputSchema } from "@/agent/lib/lead-contracts";
import {
  authorizeLeadTaskMutation,
  createAuthorizedLeadTask,
} from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Create scheduled work on one exact authorized lead. Always show the type, due date/time, and notes for owner approval before writing.",
  inputSchema: createLeadTaskInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ type }) => `Create ${type.toLowerCase()} task`,
  },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "lead.task.create",
      ctx,
      inputSummary: {
        dueAt: input.dueAt,
        hasNotes: Boolean(input.notes),
        leadId: input.leadId,
        type: input.type,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      authorize: (tx) => authorizeLeadTaskMutation(ctx, input.leadId, tx),
      execute: (tx) => createAuthorizedLeadTask(ctx, input, tx),
    });
  },
});
