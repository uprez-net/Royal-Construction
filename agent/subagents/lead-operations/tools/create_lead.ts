import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { requireCurrentAgentActor } from "@/agent/lib/actor";
import { createLeadInputSchema } from "@/agent/lib/lead-contracts";
import { createAuthorizedLead } from "@/agent/lib/lead-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Create a new lead from the client details the user gave, assigned to the caller. An existing lead with the same email or phone is reported instead of duplicated. No welcome email is sent. Show every field for owner approval before writing.",
  inputSchema: createLeadInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: ({ name }) => `Create lead for ${name}` },
  async execute(input, ctx) {
    const actor = await requireCurrentAgentActor(ctx);
    return runAuditedAgentOperation({
      action: "lead.create",
      ctx,
      inputSummary: {
        hasPhone: Boolean(input.phone),
        hasSecondaryContact: Boolean(
          input.secondaryName || input.secondaryEmail,
        ),
        projectTypes: input.projectTypes ?? [],
        source: input.source ?? null,
      },
      outputSchema: agentResultEnvelopeSchema,
      ownerUserId: actor.id,
      targetType: "lead",
      targetIdFromOutput: (output) => output.entityRef?.id,
      // createLead owns its transaction: the dedupe runs behind advisory locks
      // it takes itself.
      transactional: false,
      execute: () => createAuthorizedLead(ctx, input),
    });
  },
});
