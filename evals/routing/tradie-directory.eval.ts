import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "A tradie directory question reaches the tradie specialist.",
  tags: ["read-only", "routing"],
  async test(t) {
    // The orchestrator's instructions single this one out: "Tradie directory
    // and schedule questions belong to the tradie-operations specialist."
    // Bookings live on projects, so project-operations is the nearby wrong
    // answer this case exists to catch.
    await expectRoutedTo(t, {
      prompt:
        "Which electricians are in our tradie directory? Search the directory and list them.",
      specialist: "tradie-operations",
      usingTool: "search_tradies",
    });
  },
});
