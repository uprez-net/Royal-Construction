import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "A project question reaches the project specialist.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt:
        "Search our projects and tell me which ones are currently active.",
      specialist: "project-operations",
      usingTool: "search_projects",
    });
  },
});
