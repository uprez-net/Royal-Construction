import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateTeamRoleInputSchema } from "@/agent/lib/admin-contracts";
import { runAdminWrite, updateAuthorizedTeamRole } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Change an existing team member's role while preserving the last-admin and self-demotion safeguards.",
  inputSchema: updateTeamRoleInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runAdminWrite({ action: "admin.team.role.update", ctx, input, targetId: input.userId, targetType: "teamMember", transactional: false, execute: () => updateAuthorizedTeamRole(ctx, input) });
  },
});
