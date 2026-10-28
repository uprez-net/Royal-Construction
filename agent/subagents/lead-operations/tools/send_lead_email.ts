import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { sendLeadEmailInputSchema } from "@/agent/lib/lead-contracts";
import { sendAuthorizedLeadEmail } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Email the client of one exact authorized lead from the business mailbox, signed with the caller's name, and record it on the lead. The recipient must be the lead's primary or secondary email. Send the body exactly as the user wrote or approved it. Show the recipient and the full body for owner approval.",
  inputSchema: sendLeadEmailInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ to }) => `Email ${to}` },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "lead.email.send",
      ctx,
      inputSummary: {
        bodyLength: input.body.length,
        leadId: input.leadId,
        to: input.to,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetId: String(input.leadId),
      targetType: "lead",
      // A Graph send cannot run while holding a database transaction.
      transactional: false,
      execute: () => sendAuthorizedLeadEmail(ctx, input),
    });
  },
});
