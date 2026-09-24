import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read one fixture offer and return its envelope.",
  tags: ["read-only", "read-capabilities", "offers"],
  async test(t) {
    const offer = requireFixture(t, "offer", fixtures.offer);

    const turn = await t.send(
      `Show me the offer "${offer}" and its current status.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("offer-operations");
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    // The offer specialist resolves before it reads, so the search envelope is
    // the one guaranteed to name the fixture. `get_offer` is asserted
    // separately because a search that never resolves to a record — the agent
    // describing candidates and stopping — is the failure this case watches
    // for.
    expectEnvelopeFrom(t, run, "search_offers", { mentions: offer });
    expectEnvelopeFrom(t, run, "get_offer", { kind: "entity-summary" });
  },
});
