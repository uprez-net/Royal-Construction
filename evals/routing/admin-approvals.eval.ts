import { defineEval } from "eve/evals";
import { expectRoutedTo } from "../helpers/routing";

export default defineEval({
  description: "The approval queue reaches the admin specialist.",
  tags: ["read-only", "routing"],
  async test(t) {
    // Tradie approval requests are raised by tradie-operations but resolved
    // from the admin queue, so this prompt sits exactly on the seam.
    await expectRoutedTo(t, {
      prompt: "What is sitting in my approval queue right now?",
      specialist: "admin-operations",
      usingTool: "list_approvals",
    });
  },
});
