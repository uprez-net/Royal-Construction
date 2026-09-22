import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";

export default defineEval({
  description: "Read one fixture tradie from the directory.",
  tags: ["read-only", "read-capabilities", "tradies"],
  async test(t) {
    const tradie = requireFixture(t, "tradie", fixtures.tradie);

    await t.send(`Show me the tradie "${tradie}" from our directory.`);
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("tradie-operations");
    assertNoMutation(t);

    expectEnvelopeFrom(t, t, "get_tradie", {
      kind: "tradie-summary",
      mentions: tradie,
    });
  },
});
