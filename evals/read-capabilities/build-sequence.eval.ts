import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { expectRoutedTo } from "../helpers/routing";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description:
    "Read the admin build sequence with durations, hierarchy and valid dependency and cost-line choices.",
  tags: ["read-only", "read-capabilities", "admin", "routing"],
  async test(t) {
    const turn = await expectRoutedTo(t, {
      prompt:
        "Show me the admin build sequence template used for new projects, including estimated days, parent activities, tradie dependencies and the cost-schedule tasks we can link. Don't change anything.",
      specialist: "admin-operations",
      usingTool: "get_build_sequence",
    });
    t.noFailedActions();
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);
    const envelope = expectEnvelopeFrom(t, run, "get_build_sequence", {
      kind: "admin-summary",
    });
    if (!envelope) return;
    const data = envelope.data;
    t.check(
      data,
      satisfies(
        () =>
          typeof data.revision === "string"
          && /^[a-f0-9]{64}$/.test(data.revision)
          && Array.isArray(data.activities)
          && data.activities.length > 0
          && Array.isArray(data.tradeCategories)
          && Array.isArray(data.costTasks),
        "the read includes current revision, activities and valid edit choices",
      ),
    ).label("build sequence is ready for a subsequent reviewed edit");
  },
});
