import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listTeamInputSchema } from "@/agent/lib/admin-contracts";
import { adminOperations } from "@/agent/subagents/admin-operations/dependencies";

export default defineTool({
  description: "List Royal Construction team members and roles without exposing private account metadata.",
  inputSchema: listTeamInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  async execute(input, ctx) { return await adminOperations.listAuthorizedTeam(ctx, input); },
});
