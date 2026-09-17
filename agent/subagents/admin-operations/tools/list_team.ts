import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listTeamInputSchema } from "@/agent/lib/admin-contracts";
import { listAuthorizedTeam } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "List Royal Construction team members and roles without exposing private account metadata.",
  inputSchema: listTeamInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  execute(input, ctx) { return listAuthorizedTeam(ctx, input); },
});
