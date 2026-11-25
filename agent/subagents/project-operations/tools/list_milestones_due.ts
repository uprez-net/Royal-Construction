import { defineTool } from "eve/tools";
import { listMilestonesDueInputSchema } from "@/agent/lib/project-contracts";
import { listAuthorizedMilestonesDue } from "@/agent/lib/project-operations";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { forModel } from "@/agent/lib/model-output";

export default defineTool({
  description:
    "List open milestones due in a window of Sydney days (today, tomorrow, this week, or explicit dates) across every job in progress, with the project, status and target date of each, and by default the milestones already overdue (only started milestones on jobs being built can be overdue). Use this for briefs and any portfolio-wide 'what is due / behind?' question; never walk projects one by one with get_project.",
  inputSchema: listMilestonesDueInputSchema,
  outputSchema: agentResultEnvelopeSchema,
  toModelOutput: forModel,
  label: { start: () => "Load milestones due" },
  execute(input, ctx) {
    return listAuthorizedMilestonesDue(ctx, input);
  },
});
