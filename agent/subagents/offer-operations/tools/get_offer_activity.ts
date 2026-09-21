import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getAuthorizedOfferActivity } from "@/agent/lib/offer-operations";
import { z } from "zod";

const inputSchema = z.object({ leadId: z.number().int().positive() });

export default defineTool({
  description:
    "Read the active authorized offer's bounded send and lifecycle activity timeline for one exact lead.",
  inputSchema,
  outputSchema: agentResultEnvelopeSchema,
  label: { start: ({ leadId }) => `Load offer activity for lead ${leadId}` },
  execute(input, ctx) {
    return getAuthorizedOfferActivity(ctx, input);
  },
});
