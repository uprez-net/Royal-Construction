import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { expectGateThenCancel } from "../helpers/approval";
import { requireFixture } from "../helpers/fixtures";

export default defineEval({
  description:
    "Moving a lead between pipeline stages parks for owner approval and writes nothing when cancelled.",
  tags: ["writes", "approval", "leads"],
  timeoutMs: 300_000,
  async test(t) {
    const lead = requireFixture(t, "writeLead", fixtures.writeLead);

    await expectGateThenCancel(t, {
      prompt: `Move the lead "${lead}" to Qualified.`,
      tools: ["update_lead"],
    });

    t.judge(
      "Does the final reply state that the stage was not changed, rather than reporting that the lead moved?",
    ).atLeast(0.7);
  },
});
