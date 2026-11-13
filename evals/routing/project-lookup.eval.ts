import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "A project question reaches the project specialist.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt:
        "Use the live project search to list active projects. Do not use recalled project IDs or fetch known projects individually.",
      specialist: "project-operations",
      usingTool: "search_projects",
    });
  },
});
