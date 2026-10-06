import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listSiteManagersInputSchema } from "@/agent/lib/project-contracts";
import { listAuthorizedSiteManagers } from "@/agent/lib/project-operations";

export default defineTool({
  description:
    "List staff who can be assigned as a project's site manager, optionally filtered by name, email or phone. Use it to resolve a person the user named into an id before assign_site_manager.",
  inputSchema: listSiteManagersInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) {
    return listAuthorizedSiteManagers(ctx, input);
  },
});
