import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "List the scheduled work on one fixture lead.",
  tags: ["read-only", "read-capabilities", "leads"],
  async test(t) {
    const lead = requireFixture(t, "lead", fixtures.lead);

    const turn = await t.send(`What tasks are open on the lead "${lead}"?`);
    t.succeeded();
    t.noFailedActions();
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    expectEnvelopeFrom(t, run, "list_lead_tasks", { kind: "task-list" });
  },
});
