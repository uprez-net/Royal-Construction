import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { getProjectRequirementsInputSchema } from "@/agent/lib/project-contracts";
import { getAuthorizedProjectRequirements } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Read the complete versioned project requirements payload, including legal administration, commercials and claims, substructure, inclusions/exclusions, utilities, wet-area compliance, safety logistics, source documents, validations, conflicts, and automation triggers.",
  inputSchema: getProjectRequirementsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return getAuthorizedProjectRequirements(ctx, input); },
});
