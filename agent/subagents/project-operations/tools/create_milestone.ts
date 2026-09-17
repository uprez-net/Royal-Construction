import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createMilestoneInputSchema } from "@/agent/lib/project-contracts";
import { createAuthorizedMilestone } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Create a milestone on one authorized project with a bounded name, target date, stage, budget, and optional parent. Require owner approval.",
  inputSchema: createMilestoneInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ name }) => `Create milestone ${name}` },
  execute(input, ctx) { return createAuthorizedMilestone(ctx, input); },
});
