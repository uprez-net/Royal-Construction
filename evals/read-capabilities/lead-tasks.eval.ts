import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";

export default defineEval({
  description: "List the scheduled work on one fixture lead.",
  tags: ["read-only", "read-capabilities", "leads"],
  async test(t) {
    const lead = requireFixture(t, "lead", fixtures.lead);

    await t.send(`What tasks are open on the lead "${lead}"?`);
    t.succeeded();
    t.noFailedActions();
    assertNoMutation(t);

    expectEnvelopeFrom(t, t, "list_lead_tasks", { kind: "task-list" });
  },
});
