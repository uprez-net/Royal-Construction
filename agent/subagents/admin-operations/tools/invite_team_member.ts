import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { inviteTeamMemberInputSchema } from "@/agent/lib/admin-contracts";
import { inviteAuthorizedTeamMember, runAdminWrite } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Invite a team member with a selected role; the invitation is an externally visible action and requires owner approval.",
  inputSchema: inviteTeamMemberInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  async execute(input, ctx) {
    return await runAdminWrite({ action: "admin.team.invite", ctx, input, targetType: "teamMember", execute: () => inviteAuthorizedTeamMember(ctx, input) });
  },
});
