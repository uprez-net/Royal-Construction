import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { sendLeadWhatsAppMessageInputSchema } from "@/agent/lib/lead-whatsapp-contracts";
import { sendAuthorizedLeadWhatsAppMessage } from "@/agent/lib/lead-whatsapp-operations";
import { forModel } from "@/agent/lib/model-output";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Send one reviewed WhatsApp message to an authorized lead's own primary phone — free text inside the 24-hour reply window, otherwise an approved template. The destination is resolved server-side and cannot be chosen. Requires owner approval. Report the result exactly: if it says already sent, nothing was sent again; if the provider is unavailable, nothing was sent.",
  inputSchema: sendLeadWhatsAppMessageInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ mode }) => `Send WhatsApp ${mode}`,
  },
  execute(input, ctx) {
    // runAuditedAgentOperation (inside) gives the call its audit row and its
    // once-per-call gate; the domain's outbox gives the send its own.
    return sendAuthorizedLeadWhatsAppMessage(ctx, input);
  },
});
