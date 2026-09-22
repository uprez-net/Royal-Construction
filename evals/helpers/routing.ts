import type { EveEvalContext, EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { SPECIALISTS, type Specialist } from "../data/tools";
import { describeCalls, observedToolCalls } from "./tool-calls";

/**
 * Routing assertions.
 *
 * The orchestrator's job is to pick the smallest specialist that has the
 * capability, and its instructions say so explicitly. Two failures matter:
 * not reaching the right specialist, and reaching a *nearby* one — a tradie
 * schedule question answered by project-operations, an offer question
 * answered by lead-operations. The second is the one that produces a
 * confident, wrong answer, so every routing case names the specialists that
 * must stay out of it rather than only the one that must be in.
 */

export type RoutingCase = {
  readonly prompt: string;
  readonly specialist: Specialist;
  /**
   * Specialists that must not be delegated to. Defaults to every specialist
   * other than the expected one, which is the strict reading and the one
   * worth holding the agent to for a single-domain question.
   */
  readonly excluding?: readonly Specialist[];
  /** A tool that must have run, when the case pins the capability too. */
  readonly usingTool?: string;
};

export async function expectRoutedTo(
  t: EveEvalContext,
  routing: RoutingCase,
): Promise<EveEvalTurn> {
  const turn = await t.send(routing.prompt);

  t.succeeded();
  t.calledSubagent(routing.specialist).label(`routed to ${routing.specialist}`);

  const excluded =
    routing.excluding
    ?? SPECIALISTS.filter((name) => name !== routing.specialist);
  for (const other of excluded) {
    t.calledSubagent(other, { count: 0 }).label(`did not route to ${other}`);
  }

  if (routing.usingTool !== undefined) {
    const tool = routing.usingTool;
    const ran = observedToolCalls(t).some(
      (call) => call.name === tool && call.status === "completed",
    );
    t.check(
      ran,
      satisfies(() => ran, `"${tool}" ran; observed ${describeCalls(t)}`),
    ).label(`used ${tool}`);
  }

  return turn;
}
