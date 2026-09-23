import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { sendLeadEmailInputSchema } from "@/agent/lib/lead-contracts";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { authorizeLeadEmail } from "@/lib/domain/leads/email";
import { userPrincipal } from "@/lib/domain/principal";
import { sendAuthorizedLeadEmail } from "@/agent/lib/lead-operations";

export default defineTool({
  description:
    "Send an owner-approved email to one exact authorized lead contact. The recipient must already be recorded on that lead. The signed message uses the authenticated staff member's name and is added to the lead's email history.",
  inputSchema: sendLeadEmailInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ leadId, to }) => `Send email to ${to} for lead ${leadId}`,
  },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "lead.email.send",
      ctx,
      inputSummary: {
        bodyLength: input.body.length,
        leadId: input.leadId,
        subject: input.subject,
        to: input.to,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      authorize: async (tx) => {
        await authorizeLeadEmail(
          userPrincipal(actor),
          { leadId: input.leadId, to: input.to },
          tx,
        );
      },
      execute: () => sendAuthorizedLeadEmail(ctx, input),
      transactional: false,
    });
  },
});
