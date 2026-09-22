import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "A lead lookup reaches the lead specialist and nothing else.",
  tags: ["read-only", "routing"],
  async test(t) {
    await expectRoutedTo(t, {
      prompt:
        "Which of our leads are based in Sydney? Just list the names you can see.",
      specialist: "lead-operations",
      usingTool: "search_leads",
    });
  },
});
