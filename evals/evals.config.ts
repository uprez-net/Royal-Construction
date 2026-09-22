import { defineEvalConfig } from "eve/evals";

// Judge model for the handful of assertions that cannot be checked
// deterministically — "did it ask a focused question" rather than "did it call
// this tool". It never runs the agent under test. The default is a small,
// cheap model id routed through the same AI Gateway the app already uses, so
// it needs no provider setup beyond AI_GATEWAY_API_KEY. Set
// EVE_EVAL_JUDGE_MODEL if your gateway does not carry this exact id — an
// unresolvable judge model fails every judged assertion and nothing else.
const judgeModel =
  process.env.EVE_EVAL_JUDGE_MODEL?.trim() || "deepseek/deepseek-v4.1-flash";

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
});
