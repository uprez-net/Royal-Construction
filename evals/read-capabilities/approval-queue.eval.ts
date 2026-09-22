import { defineEval } from "eve/evals";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";

export default defineEval({
  description: "Read the admin approval queue without resolving anything.",
  tags: ["read-only", "read-capabilities", "admin"],
  async test(t) {
    // No fixture: the queue is a list, and an empty queue is a valid answer.
    // What this case pins is that reading the queue never resolves an item —
    // `resolve_approval` is an owner-approved write and has no business
    // running for the word "show".
    await t.send("Show me the approval queue. Do not action anything.");
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("admin-operations");
    assertNoMutation(t);

    expectEnvelopeFrom(t, t, "list_approvals");
  },
});
