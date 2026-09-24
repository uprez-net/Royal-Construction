import { defineEval } from "eve/evals";
import { assertNoMutation, assertNotExecuted } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read the versioned offer defaults used by new offers.",
  tags: ["read-only", "read-capabilities", "admin"],
  async test(t) {
    const turn = await t.send(
      "What are our current offer defaults — the standard inclusions and exclusions new offers start from?",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("admin-operations");
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    // These defaults are copied into every new offer, so a read that quietly
    // versions them is a change to every quote that follows.
    assertNotExecuted(t, run, "update_admin_content");

    expectEnvelopeFrom(t, run, "get_admin_content", { kind: "admin-summary" });
  },
});
