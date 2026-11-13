import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { setComplianceDocumentRequiredInputSchema } from "@/agent/lib/project-contracts";
import { setAuthorizedComplianceDocumentRequired } from "@/agent/lib/project-operations";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "Mark a checklist or conditional DA compliance row not required, or restore it to required, without deleting evidence. Approved rows cannot be reopened; require owner approval.",
  inputSchema: setComplianceDocumentRequiredInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  approval: ownerOnlyApproval(),
  label: {
    start: ({ notRequired }) =>
      notRequired
        ? "Mark compliance not required"
        : "Restore compliance requirement",
  },
  execute(input, ctx) {
    return setAuthorizedComplianceDocumentRequired(ctx, input);
  },
});
