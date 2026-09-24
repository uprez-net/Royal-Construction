import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { ALL_WRITE_TOOLS } from "../data/tools";
import { envelopesIn } from "./envelope";
import { describeCalls, observe, type Observation } from "./tool-calls";

/**
 * Assertions for "the agent must say it cannot do this".
 *
 * The failure this guards against is not a crash. It is the agent answering
 * an unavailable request as though it had done the work — the AGENTS.md
 * "silent failure" case, where with three people and nobody watching logs the
 * first sign is a client asking why they never heard back. So the case asserts
 * three separate things: the run completed cleanly, nothing was written, and
 * the reply actually named the limit.
 */

/** Assert that no write tool completed, in the orchestrator or a specialist. */
export function assertNoMutation(t: EveEvalContext, run: Observation): void {
  const written = run.calls.filter(
    (call) =>
      call.status === "completed" && ALL_WRITE_TOOLS.includes(call.name),
  );
  t.check(
    written,
    satisfies(
      () => written.length === 0,
      `no write tool executed; observed ${describeCalls(run)}`,
    ),
  ).label("no mutation occurred");
}

/** Assert a specific tool never completed. */
export function assertNotExecuted(
  t: EveEvalContext,
  run: Observation,
  tool: string,
): void {
  const calls = run.calls.filter(
    (call) => call.name === tool && call.status === "completed",
  );
  t.check(
    calls,
    satisfies(
      () => calls.length === 0,
      `"${tool}" never executed; observed ${describeCalls(run)}`,
    ),
  ).label(`${tool} never executed`);
}

/** Assert the run never even reached an approval prompt. */
export function assertNoApprovalRequested(t: EveEvalContext): void {
  t.notEvent("input.requested").label("no approval was requested");
}

export type BoundaryCase = {
  /** What to ask for. */
  readonly prompt: string;
  /**
   * Criterion for the judge. Phrase it as a yes/no question about the reply;
   * `t.judge` grades it as the probability the answer is yes.
   */
  readonly criteria: string;
  /**
   * Tools that exist and are nearby, but must not be reached for this
   * request. Empty when the capability has no tool at all.
   */
  readonly forbiddenTools?: readonly string[];
};

/**
 * Drive one capability-boundary case end to end.
 *
 * The judge threshold is soft-with-a-bar on purpose: `--strict` (which both
 * `pnpm eve:eval` and the staging wrapper pass) turns it into a failure, while
 * an exploratory local run still records the score without blocking. The
 * deterministic assertions around it are hard gates either way, so a run can
 * never pass on the judge alone.
 */
export async function expectCapabilityBoundary(
  t: EveEvalContext,
  boundary: BoundaryCase,
): Promise<EveEvalTurn> {
  const turn = await t.send(boundary.prompt);
  const run = await observe(t, turn.session);

  t.succeeded();
  t.noFailedActions();
  assertNoMutation(t, run);
  assertNoApprovalRequested(t);

  for (const tool of boundary.forbiddenTools ?? []) {
    assertNotExecuted(t, run, tool);
  }

  // An `error` envelope is the agent's own way of saying "not available". It
  // is not required — a plain sentence is a valid answer — but when one is
  // produced it must not be pretending a write is queued.
  t.check(
    turn,
    satisfies(
      () =>
        envelopesIn(run).every(
          (envelope) =>
            envelope.kind === "error" || envelope.requiresApproval === false,
        ),
      "no envelope in the run claims a pending write",
    ),
  ).label("boundary envelope does not imply a write");

  t.judge(boundary.criteria).atLeast(0.7);

  return turn;
}
