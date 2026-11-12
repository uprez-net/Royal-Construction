import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description:
    "Counting the pipeline lists leads with no search text instead of guessing.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt: "How many leads do we have in the pipeline, by stage?",
      specialist: "lead-operations",
      usingTool: "search_leads",
    });
  },
});
