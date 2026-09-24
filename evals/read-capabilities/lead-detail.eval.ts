import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read one fixture lead and return an entity-summary envelope.",
  tags: ["read-only", "read-capabilities", "leads"],
  async test(t) {
    const lead = requireFixture(t, "lead", fixtures.lead);

    const turn = await t.send(
      `Open the lead "${lead}" and summarise where it is up to.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("lead-operations");
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    expectEnvelopeFrom(t, run, "get_lead", {
      kind: "entity-summary",
      mentions: lead,
    });
  },
});
