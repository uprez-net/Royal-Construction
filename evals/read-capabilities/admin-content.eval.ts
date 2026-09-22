import { defineEval } from "eve/evals";
import { assertNoMutation, assertNotExecuted } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";

export default defineEval({
  description: "Read the versioned offer defaults used by new offers.",
  tags: ["read-only", "read-capabilities", "admin"],
  async test(t) {
    await t.send(
      "What are our current offer defaults — the standard inclusions and exclusions new offers start from?",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("admin-operations");
    assertNoMutation(t);

    // These defaults are copied into every new offer, so a read that quietly
    // versions them is a change to every quote that follows.
    assertNotExecuted(t, "update_admin_content");

    expectEnvelopeFrom(t, t, "get_admin_content", { kind: "admin-summary" });
  },
});
