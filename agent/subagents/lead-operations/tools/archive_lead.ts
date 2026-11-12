import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { archiveLeadInputSchema } from "@/agent/lib/lead-contracts";
import { archiveAuthorizedLead } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Archive one exact authorized lead so it leaves every lead list. The record is kept. Name the lead for owner approval first.",
  inputSchema: archiveLeadInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Archive lead" },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "lead.archive",
      ctx,
      inputSummary: { leadId: input.leadId },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      transactional: false,
      execute: () => archiveAuthorizedLead(ctx, input),
    });
  },
});
