import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import {
  expectEnvelopeFrom,
  expectUsableDelegateResult,
} from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "Read one fixture project and return its envelope.",
  tags: ["read-only", "read-capabilities", "projects"],
  async test(t) {
    const project = requireFixture(t, "project", fixtures.project);

    const turn = await t.send(
      `Give me an overview of the project "${project}".`,
    );
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("project-operations");
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    expectEnvelopeFrom(t, run, "get_project", {
      kind: "entity-summary",
      mentions: project,
    });
    expectUsableDelegateResult(t, run, project);
  },
});
