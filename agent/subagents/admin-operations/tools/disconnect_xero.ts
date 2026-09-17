import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { disconnectXeroInputSchema } from "@/agent/lib/admin-contracts";
import { disconnectAuthorizedXero, runAdminWrite } from "@/agent/lib/admin-operations";

export default defineTool({
  description: "Disconnect the active Xero organisation, revoke its token best-effort, and deactivate the local connection.",
  inputSchema: disconnectXeroInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runAdminWrite({ action: "admin.xero.disconnect", ctx, input, targetType: "xeroConnection", execute: () => disconnectAuthorizedXero(ctx, input) });
  },
});
