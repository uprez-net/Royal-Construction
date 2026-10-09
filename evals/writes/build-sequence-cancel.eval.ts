import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { updateBuildSequenceInputSchema } from "@/agent/lib/admin-contracts";
import { approvalTargets, cancel, sendForApproval } from "../helpers/approval";
import { assertNoMutation, assertNotExecuted } from "../helpers/boundaries";
import { evalMarker } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description:
    "A new template activity requires owner approval; cancellation preserves the global build sequence.",
  tags: ["writes", "approval", "admin"],
  timeoutMs: 300_000,
  async test(t) {
    const marker = evalMarker();
    const { request, turn } = await sendForApproval(
      t,
      `In the admin build sequence template for new projects, add one root activity named "${marker}" at the end, in the Slab stage, with five estimated calendar days, no tradie dependency and no related cost lines. Preserve all existing activities.`,
      "update_build_sequence",
    );
    approvalTargets(t, request, marker);
    const proposed = updateBuildSequenceInputSchema.safeParse(
      request.action.input,
    );
    t.check(
      proposed,
      satisfies(
        () =>
          proposed.success
          && proposed.data.changes.length === 1
          && proposed.data.changes[0].type === "add"
          && proposed.data.changes[0].activity.name === marker,
        "the proposal adds only the requested activity using a current revision",
      ),
    ).label("approval contains a targeted build sequence edit");
    const resumed = await cancel(turn.session, request);
    resumed.expectOk();
    const run = await observe(t, turn.session);
    assertNotExecuted(t, run, "update_build_sequence");
    assertNoMutation(t, run);
  },
});
