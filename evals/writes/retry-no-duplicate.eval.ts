import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { fixtures } from "../data/fixtures";
import {
  approve,
  assertExecutedOnce,
  sendForApproval,
} from "../helpers/approval";
import {
  countOccurrences,
  evalMarker,
  requireFixture,
} from "../helpers/fixtures";
import { completedCalls, observe } from "../helpers/tool-calls";

/**
 * Retrying an approval does not write twice.
 *
 * This is the one-person concurrency case AGENTS.md says to weigh, not the
 * two-user one: the office approves a task, the response times out or the tab
 * is left open, and the same approval is submitted again. There are two
 * correct answers and the case accepts both — the replay is refused because
 * the request is already settled, or it is accepted and settles the same call
 * a second time without a second write. `agent/lib/audited-operation.ts` keys
 * the operation on `agent:{session}:{callId}:{action}`, so the same call id
 * replays its recorded result rather than running again.
 *
 * What the case does *not* claim: that asking twice in two separate turns is
 * deduplicated. It is not, and it cannot be — a new turn is a new call id and
 * a genuinely new instruction. That limit is written down in evals/README.md
 * rather than papered over with an assertion that would pass by luck.
 */
export default defineEval({
  description:
    "Re-submitting the same approval does not create a second persistent action.",
  tags: ["writes", "approval", "idempotency"],
  timeoutMs: 420_000,
  async test(t) {
    const lead = requireFixture(t, "writeLead", fixtures.writeLead);
    const marker = evalMarker();

    const { request, turn } = await sendForApproval(
      t,
      `Create a follow-up task on the lead "${lead}" due tomorrow at 2pm, with the note exactly "${marker}".`,
      "create_lead_task",
    );

    const first = await approve(turn.session, request);
    first.expectOk();
    assertExecutedOnce(t, await observe(t, turn.session), "create_lead_task");

    // The retry. A rejection here is a pass, not an error, so the failure is
    // caught and recorded rather than thrown.
    let replayRefused = false;
    try {
      await approve(turn.session, request);
    } catch (error) {
      replayRefused = true;
      t.log(
        `replayed approval refused: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!replayRefused) t.log("replayed approval was accepted and settled");

    // Either way, exactly one write.
    assertExecutedOnce(t, await observe(t, turn.session), "create_lead_task");

    const readback = await t.send(
      `List every task on the lead "${lead}" whose note contains "${marker}". Say how many there are.`,
    );
    readback.expectOk();

    // Count off one task-list envelope rather than off the prose or the whole
    // event stream: the marker is echoed in the reply too, and the specialist
    // may list the tasks more than once, either of which would inflate a
    // naive count. One envelope, one marker, one task.
    const listing = completedCalls(
      await observe(t, readback.session),
      "list_lead_tasks",
    ).at(-1);
    await t.require(
      listing,
      satisfies(
        (value) => value !== undefined,
        "the verifying session listed the lead's tasks",
      ),
    );
    const occurrences = countOccurrences(listing!.output, marker);
    t.check(
      occurrences,
      satisfies(
        (count) => count === 1,
        `exactly one persisted task carries marker "${marker}"; found ${occurrences}`,
      ),
    ).label("no duplicate persistent action");

    // Deliberately not closed out here. The point of this case is the state
    // the retry left behind, and closing it would add two more approved turns
    // to an already long run. `pnpm eve:eval:fixtures reset` collects every
    // task carrying the EVE-EVAL marker; the runbook says to run it after a
    // write-tagged run.
    t.log(`retry case left task marker ${marker} for eve:eval:fixtures reset`);
  },
});
