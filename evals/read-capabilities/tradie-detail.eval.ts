import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read one fixture tradie from the directory.",
  tags: ["read-only", "read-capabilities", "tradies"],
  async test(t) {
    const tradie = requireFixture(t, "tradie", fixtures.tradie);

    const turn = await t.send(
      `Show me the tradie "${tradie}" from our directory.`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("tradie-operations");
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    expectEnvelopeFrom(t, run, "get_tradie", {
      kind: "tradie-summary",
      mentions: tradie,
    });
  },
});
