import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { envelopesIn } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description:
    "Read the milestones on one fixture project without changing them.",
  tags: ["read-only", "read-capabilities", "projects"],
  async test(t) {
    const project = requireFixture(
      t,
      "milestoneProject",
      fixtures.milestoneProject,
    );

    const turn = await t.send(
      `List the milestones on the project "${project}" with their dates. Do not change anything.`,
    );
    t.succeeded();
    t.noFailedActions();
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    // Milestones arrive either as their own `milestone-list` envelope or
    // folded into the project summary, depending on which read the specialist
    // picks. Both are correct answers to the question; pinning one would be
    // asserting an implementation detail rather than the capability.
    const envelopes = envelopesIn(run);
    t.check(
      envelopes,
      satisfies(
        () =>
          envelopes.some(
            (envelope) =>
              envelope.kind === "milestone-list"
              || envelope.kind === "entity-summary",
          ),
        "a milestone-list or project entity-summary envelope was produced",
      ),
    ).label("milestone read envelope");
  },
});
