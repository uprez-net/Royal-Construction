import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";

export default defineEval({
  description: "Read one fixture project and return its envelope.",
  tags: ["read-only", "read-capabilities", "projects"],
  async test(t) {
    const project = requireFixture(t, "project", fixtures.project);

    await t.send(`Give me an overview of the project "${project}".`);
    t.succeeded();
    t.noFailedActions();
    t.calledSubagent("project-operations");
    assertNoMutation(t);

    expectEnvelopeFrom(t, t, "get_project", {
      kind: "entity-summary",
      mentions: project,
    });
  },
});
