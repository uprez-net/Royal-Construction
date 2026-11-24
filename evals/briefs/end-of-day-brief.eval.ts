import { defineEval } from "eve/evals";
import { expectCompleteBrief } from "../helpers/briefs";

export default defineEval({
  description:
    "The end-of-day brief finishes with no incomplete specialist result and without walking records one by one (#618).",
  tags: ["read-only", "briefs"],
  async test(t) {
    await expectCompleteBrief(
      t,
      "End of day brief, live from the CRM: what is still overdue, lead tasks and meetings due tomorrow with their owners, milestones due tomorrow, and offers that changed today or are due a follow-up.",
    );
  },
});
