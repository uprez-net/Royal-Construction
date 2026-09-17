import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { searchProjectsInputSchema } from "@/agent/lib/project-contracts";
import { searchAuthorizedProjects } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Search projects visible to the current site manager or administrator by name or location.",
  inputSchema: searchProjectsInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return searchAuthorizedProjects(ctx, input); },
});
