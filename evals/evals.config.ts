import { defineEvalConfig } from "eve/evals";
import { installEvaluatorTokenRefresh } from "@/lib/eval/evaluator-token";

// Judge model for the handful of assertions that cannot be checked
// deterministically — "did it ask a focused question" rather than "did it call
// this tool". Eve's judge uses the evaluation API, so this must be a decision
// model, not a language model. It never runs the agent under test. Override
// EVE_EVAL_JUDGE_MODEL with another gateway evaluation model when needed.
const judgeModel =
  process.env.EVE_EVAL_JUDGE_MODEL?.trim() || "typesafe-ai/jev";

export default defineEvalConfig({
  judge: { model: judgeModel },
  // Live writes are deliberately serial, and the staging wrapper enforces the
  // same setting even when an operator supplies their own CLI flags. Two
  // concurrent sessions against one staging database would race on the
  // disposable fixture records the write cases mutate.
  maxConcurrency: 1,
  // A staging turn goes out to a real model through a real deployment, and an
  // approval case sends three turns. The default is far too tight for that.
  timeoutMs: 180_000,
  // Against staging, `eve eval` sends one five-minute token for the whole
  // run, and a suite takes about that long. Setup runs in this process before
  // eve creates its client, so it can keep that bearer fresh; teardown
  // revokes the sessions it minted. A local run has no token and is untouched.
  setup() {
    return { tokenRefresh: installEvaluatorTokenRefresh() };
  },
  async teardown(context) {
    await context?.tokenRefresh?.revokeRefreshed();
  },
});
