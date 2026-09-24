import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "An offer status question reaches the offer specialist.",
  tags: ["read-only", "routing"],
  async test(t) {
    // Deliberately phrased with a client's name in it, which is the phrasing
    // most likely to pull the orchestrator towards lead-operations.
    await expectRoutedTo(t, {
      prompt:
        "Which offers are sitting unsigned at the moment? Search our offers and tell me what you find.",
      specialist: "offer-operations",
      usingTool: "search_offers",
    });
  },
});
