import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { revokeTeamInvitationInputSchema } from "@/agent/lib/admin-contracts";
import {
  revokeAuthorizedTeamInvitation,
  runAdminWrite,
} from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Revoke a pending Clerk team invitation after confirmation.",
  inputSchema: revokeTeamInvitationInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runAdminWrite({
      action: "admin.team.invitation.revoke",
      ctx,
      input,
      targetId: input.invitationId,
      targetType: "teamMember",
      transactional: false,
      execute: () => revokeAuthorizedTeamInvitation(ctx, input),
    });
  },
});
