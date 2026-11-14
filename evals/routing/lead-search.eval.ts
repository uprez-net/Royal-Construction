import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "A lead lookup reaches the lead specialist and nothing else.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt:
        "Search the live lead records now for Sydney, rather than using the office snapshot or recall results. List the names and their stored locations.",
      specialist: "lead-operations",
      usingTool: "search_leads",
    });
  },
});
