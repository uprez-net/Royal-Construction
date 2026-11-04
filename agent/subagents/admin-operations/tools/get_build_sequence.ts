import { defineTool } from "eve/tools";
import { getBuildSequenceInputSchema } from "@/agent/lib/admin-contracts";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createAdminOperations, type AdminOperations } from "../dependencies";

export function createGetBuildSequenceTool(operations: AdminOperations) {
  return defineTool({
    description:
      "Read the admin build sequence template, its revision, activity IDs/order/parent links/stages, estimated calendar days, tradie dependencies, category IDs/icons/archived flags and valid AdminOfferContent cost-schedule task names. This is the default plan for new projects, not one project's live milestones. Read before editing; never invent category IDs or cost-line task names.",
    inputSchema: getBuildSequenceInputSchema,
    outputSchema: agentResultEnvelopeSchema,
    label: { start: () => "Read project build sequence" },
    execute(_input, ctx) {
      return operations.getAuthorizedBuildSequence(ctx);
    },
  });
}

export default createGetBuildSequenceTool(createAdminOperations());
