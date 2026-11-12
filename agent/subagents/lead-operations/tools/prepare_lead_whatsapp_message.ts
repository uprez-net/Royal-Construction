import { defineTool } from "eve/tools";
import { prepareLeadWhatsAppMessageInputSchema } from "@/agent/lib/lead-whatsapp-contracts";
import { prepareAuthorizedLeadWhatsAppMessage } from "@/agent/lib/lead-whatsapp-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

export default defineTool({
  description:
    "Preview, without sending, exactly what a WhatsApp message to an authorized lead would be: the lead's own destination number, the Royal sender number, the rendered text or template, and whether that mode is currently allowed and why not. Always run this and show the preview before asking to send.",
  inputSchema: prepareLeadWhatsAppMessageInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: {
    start: ({ mode }) => `Preview WhatsApp ${mode}`,
  },
  execute(input, ctx) {
    return prepareAuthorizedLeadWhatsAppMessage(ctx, input);
  },
});
