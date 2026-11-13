import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { assignSiteManagerInputSchema } from "@/agent/lib/project-contracts";
import { assignAuthorizedSiteManager } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Reassign one authorized project to a different site manager, using a siteManagerId from list_site_managers. Administrators only; require owner approval.",
  inputSchema: assignSiteManagerInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: { start: () => "Reassign project site manager" },
  execute(input, ctx) {
    return assignAuthorizedSiteManager(ctx, input);
  },
});
