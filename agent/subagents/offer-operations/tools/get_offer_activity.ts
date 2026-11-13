import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getAuthorizedOfferActivity } from "@/agent/lib/offer-operations";
import { z } from "zod";
import { forModel } from "@/agent/lib/model-output";

const inputSchema = z.object({ leadId: z.number().int().positive() });

export default defineTool({
  description:
    "Read the active authorized offer's bounded send and lifecycle activity timeline for one exact lead.",
  inputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  label: { start: () => "Load offer activity" },
  execute(input, ctx) {
    return getAuthorizedOfferActivity(ctx, input);
  },
});
