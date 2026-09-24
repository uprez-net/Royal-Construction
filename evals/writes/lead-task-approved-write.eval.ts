import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { fixtures } from "../data/fixtures";
import {
  approvalTargets,
  approve,
  assertExecutedOnce,
  sendForApproval,
} from "../helpers/approval";
import { gradeEnvelope } from "../helpers/envelope";
import {
  countOccurrences,
  evalMarker,
  requireFixture,
} from "../helpers/fixtures";
import { completedCalls, observe } from "../helpers/tool-calls";

/**
 * The one disposable write the staging suite actually completes.
 *
 * A lead task is the right choice: it is internal, it has no client-facing
 * side effect, the lead it hangs off is a dedicated fixture, and the domain
 * gives us a way to close it out afterwards. Everything else that writes
 * either reaches a client or is hard to undo.
 *
 * The case proves the whole chain rather than the happy reply: the approval
 * happened, the tool executed exactly once, the write is visible from a
 * *different* session (so it is in the database, not in the first session's
 * context), and the record is closed out at the end. The durable rows behind
 * it — `AgentOperation` and `AgentActionAudit` — are checked by
 * `scripts/eve-eval-fixtures.ts verify`, which is the operator-side half
 * documented in docs/eve-staging-evals.md; it lives there rather than here so
 * the evaluator machine never needs a database credential.
 */
export default defineEval({
  description:
    "An approved lead task is written once, is visible from a second session, and is closed out.",
  tags: ["writes", "approval", "persistence"],
  timeoutMs: 420_000,
  async test(t) {
    const lead = requireFixture(t, "writeLead", fixtures.writeLead);
    const marker = evalMarker();

    // ── 1. Ask, and park ────────────────────────────────────────────────
    const { request, turn } = await sendForApproval(
      t,
      `Create a follow-up task on the lead "${lead}" due tomorrow at 9am, with the note exactly "${marker}".`,
      "create_lead_task",
    );
    approvalTargets(t, request, marker);

    // ── 2. Approve ──────────────────────────────────────────────────────
    const written = await approve(turn.session, request);
    written.expectOk();
    t.succeeded();
    const afterWrite = await observe(t, turn.session);
    assertExecutedOnce(t, afterWrite, "create_lead_task");

    const call = completedCalls(afterWrite, "create_lead_task").at(-1);
    await t.require(
      call,
      satisfies(
        (value) => value !== undefined,
        "the approved create_lead_task call completed",
      ),
    );
    const envelope = gradeEnvelope(t, call!, { mentions: marker });
    t.check(
      envelope?.kind,
      satisfies(
        (value) => value === "confirmation" || value === "task-list",
        "the write returned a confirmation or task-list envelope",
      ),
    ).label("write envelope kind");

    // ── 3. Verify from a session that never saw the write ───────────────
    // Reading it back in the same session would prove only that the model
    // remembers what it just said. A second session has to go to the database.
    const readback = await t.send(
      `List the open tasks on the lead "${lead}" with their notes.`,
    );
    readback.expectOk();

    const occurrences = countOccurrences(readback.events, marker);
    t.check(
      occurrences,
      satisfies(
        (count) => typeof count === "number" && count > 0,
        `the new task is visible from an independent session (marker "${marker}")`,
      ),
    ).label("write is persisted");

    // ── 4. Close it out ─────────────────────────────────────────────────
    // Completing the task is itself an owner-approved write, so the cleanup
    // path exercises the same gate a second time. The row is left behind in a
    // completed state; `eve:eval:fixtures reset` removes it.
    const { request: closeRequest, turn: closeTurn } = await sendForApproval(
      t,
      `Mark the task noted "${marker}" on the lead "${lead}" as complete.`,
      "complete_lead_task",
    );
    const closed = await approve(closeTurn.session, closeRequest);
    closed.expectOk();
    assertExecutedOnce(
      t,
      await observe(t, closeTurn.session),
      "complete_lead_task",
    );

    t.log(`created and closed out task marker ${marker}`);
  },
});
