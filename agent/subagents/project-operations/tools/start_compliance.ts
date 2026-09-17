import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { startComplianceInputSchema } from "@/agent/lib/project-contracts";
import { startAuthorizedCompliance } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Start the compliance engagement for one authorized project, snapshotting the certifier contact and seeding the canonical required document checklist. Require owner approval.",
  inputSchema: startComplianceInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: () => "Start compliance engagement" },
  execute(input, ctx) { return startAuthorizedCompliance(ctx, input); },
});
