import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

/** No search text: an omitted, empty or blank `query`. */
function hasNoQuery(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const query = (input as { query?: unknown }).query;
  return (
    query === undefined
    || query === null
    || (typeof query === "string" && query.trim() === "")
  );
}

export default defineEval({
  description:
    "Counting the pipeline lists leads with no search text instead of guessing.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt: "How many leads do we have in the pipeline, by stage?",
      specialist: "lead-operations",
      toolInput: {
        describe: "was called with no search text",
        matches: hasNoQuery,
      },
      usingTool: "search_leads",
    });
  },
});
