import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read the compliance engagement on one fixture project.",
  tags: ["read-only", "read-capabilities", "compliance"],
  async test(t) {
    const project = requireFixture(
      t,
      "complianceProject",
      fixtures.complianceProject,
    );

    const turn = await t.send(
      `What is the compliance status of the project "${project}"? Read it only.`,
    );
    t.succeeded();
    t.noFailedActions();
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    // Deliberately no `calledSubagent("compliance-operations")`. The
    // compliance tools live under project-operations, and
    // agent/subagents/compliance-operations has no tools directory at all, so
    // pinning the specialist would assert a routing shape the capability
    // surface does not actually have. The tool is the contract here; the
    // limitation is written down in evals/README.md.
    expectEnvelopeFrom(t, run, "get_compliance", { kind: "compliance-status" });
  },
});
