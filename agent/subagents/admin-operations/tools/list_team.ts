import { defineTool } from "eve/tools";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { listTeamInputSchema } from "@/agent/lib/admin-contracts";
import {
  createAdminOperations,
  type AdminOperations,
} from "@/agent/subagents/admin-operations/dependencies";

export function createListTeamTool(operations: AdminOperations) {
  return defineTool({
    description:
      "List Royal Construction team members and roles without exposing private account metadata.",
    inputSchema: listTeamInputSchema,
    outputSchema: agentResultEnvelopeSchema,
    async execute(input, ctx) {
      return await operations.listAuthorizedTeam(ctx, input);
    },
  });
}

export default createListTeamTool(createAdminOperations());
