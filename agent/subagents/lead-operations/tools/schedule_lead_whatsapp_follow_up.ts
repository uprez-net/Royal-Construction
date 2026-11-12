import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { scheduleLeadWhatsAppFollowUpInputSchema } from "@/agent/lib/lead-whatsapp-contracts";
import {
  authorizeLeadTaskMutation,
  createAuthorizedLeadTask,
} from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Schedule a WhatsApp follow-up task on one exact authorized lead. It only books the work; it sends nothing. Show the due date/time and notes for owner approval before writing.",
  inputSchema: scheduleLeadWhatsAppFollowUpInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: () => "Schedule WhatsApp follow-up",
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
        type: "WHATSAPP",
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      authorize: (tx) => authorizeLeadTaskMutation(ctx, input.leadId, tx),
      // The same task path as create_lead_task, typed WHATSAPP so follow-up
      // reporting can tell it from an email chase.
      execute: (tx) =>
        createAuthorizedLeadTask(ctx, { ...input, type: "WHATSAPP" }, tx),
    });
  },
});
