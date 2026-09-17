import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateProjectRequirementsInputSchema } from "@/agent/lib/project-contracts";
import { updateAuthorizedProjectRequirements } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Update one or more known sections of a project requirements payload using the exact updatedAt from a prior read. Preserve the full versioned shape and source evidence; require owner approval.",
  inputSchema: updateProjectRequirementsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ patch }) => `Update requirements ${Object.keys(patch).join(", ")}` },
  execute(input, ctx) { return updateAuthorizedProjectRequirements(ctx, input); },
});
