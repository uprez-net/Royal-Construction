import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { resolveComplianceDocumentInputSchema } from "@/agent/lib/project-contracts";
import { resolveAuthorizedComplianceDocument } from "@/agent/lib/project-operations";

export default defineTool({
  description: "Approve or reject uploaded/received evidence on an approvable compliance checklist row, enforcing evidence and rejection-reason gates. Require owner approval.",
  inputSchema: resolveComplianceDocumentInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  approval: ownerOnlyApproval(),
  label: { start: ({ decision }) => `${decision === "approved" ? "Approve" : "Reject"} compliance evidence` },
  execute(input, ctx) { return resolveAuthorizedComplianceDocument(ctx, input); },
});
