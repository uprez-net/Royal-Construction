import { defineTool } from "eve/tools";
import { ownerOnlyApproval } from "@/agent/lib/agent-approval";
import { updateBuildSequenceInputSchema } from "@/agent/lib/admin-contracts";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { createAdminOperations, type AdminOperations } from "../dependencies";

export function createUpdateBuildSequenceTool(operations: AdminOperations) {
  return defineTool({
    description:
      "Apply targeted admin build sequence changes using the revision from get_build_sequence. Supports add, update (name, projectStage, estimatedDays, requiredTradeTypeIds, relatedCostLines), move before another activity, nest as a child, detach to the end as a root, and remove a leaf. Moves carry the full subtree. Changes run in order and save atomically; omitted activities are preserved. Add defaults to five calendar days and no tradie dependencies; an optional fresh UUID lets later changes in the same batch refer to the new activity. Use only returned trade category IDs and cost-schedule task names. requiredTradeTypeIds lists every trade the activity needs and replaces the current list, so include the ones to keep; an empty list clears the dependencies and an empty relatedCostLines clears cost lines. Removing a parent requires moving its children first. Read current state, explain exact changes, and require owner approval. On a stale revision read again and obtain fresh approval. Changes affect new projects only.",
    inputSchema: updateBuildSequenceInputSchema,
    outputSchema: agentResultEnvelopeSchema,
    approval: ownerOnlyApproval(),
    label: {
      start: ({ changes }) =>
        `Save ${changes.length} build sequence change${changes.length === 1 ? "" : "s"}`,
    },
    execute(input, ctx) {
      return operations.runAdminWrite({
        action: "admin.build-sequence.update",
        ctx,
        input,
        targetType: "milestoneTemplate",
        transactional: true,
        execute: (tx) =>
          operations.updateAuthorizedBuildSequence(ctx, input, tx),
      });
    },
  });
}

export default createUpdateBuildSequenceTool(createAdminOperations());
