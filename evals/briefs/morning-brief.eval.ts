import { defineEval } from "eve/evals";
import { expectCompleteBrief } from "../helpers/briefs";

export default defineEval({
  description:
    "The morning brief finishes with no incomplete specialist result and without walking records one by one (#618).",
  tags: ["read-only", "briefs"],
  async test(t) {
    await expectCompleteBrief(
      t,
      "Morning brief, live from the CRM: lead tasks due today and who owns each, today's meetings, anything overdue, milestones due today or this week and any that are behind, and offers out for signature or due a follow-up.",
    );
  },
});
