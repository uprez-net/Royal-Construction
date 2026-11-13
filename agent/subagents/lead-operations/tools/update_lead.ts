import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { updateLeadInputSchema } from "@/agent/lib/lead-contracts";
import { updateAuthorizedLead } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Change one exact authorized lead: contact details, source, project types, deal value and dates, pipeline stage (Lost, Cancelled and Disqualified need lostReason), meeting or follow-up date/time, or assignee. Send only the fields that change; null clears a field. Show the lead and every change for owner approval.",
  inputSchema: updateLeadInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ leadId, changes }) =>
      changes.stage
        ? `Move lead ${leadId} to ${changes.stage}`
        : `Update lead ${leadId}`,
  },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: input.changes.stage ? "lead.stage.change" : "lead.update",
      ctx,
      inputSummary: {
        changedFields: Object.keys(input.changes),
        leadId: input.leadId,
        stage: input.changes.stage ?? null,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      // updateLead opens its own transaction for the stage and history write.
      transactional: false,
      execute: () => updateAuthorizedLead(ctx, input),
    });
  },
});
