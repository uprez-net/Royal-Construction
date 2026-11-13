import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { updateAdminContentInputSchema } from "@/agent/lib/admin-contracts";
import {
  runAdminWrite,
  updateAuthorizedAdminContent,
} from "@/agent/lib/admin-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Update one validated section of admin offer defaults using an expected version; read first and require owner approval.",
  inputSchema: updateAdminContentInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  execute(input, ctx) {
    return runAdminWrite({
      action: "admin.content.update",
      ctx,
      input,
      targetType: "adminContent",
      execute: () => updateAuthorizedAdminContent(ctx, input),
    });
  },
});
