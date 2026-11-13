import assert from "node:assert/strict";
import { test } from "vitest";

import { estimateCostUsd, OPERATIONS_MODEL_PRICING } from "@/lib/agent/model";
import {
  listPriceAtCeiling,
  OPERATIONS_SESSION_LIMITS,
  SPECIALIST_SESSION_LIMITS,
} from "@/lib/agent/session-limits";

test("GPT-6-Luna-fast is priced at $0.20/M input and $1.00/M output", () => {
  assert.deepEqual(OPERATIONS_MODEL_PRICING, {
    inputUsdPerMillionTokens: 0.2,
    outputUsdPerMillionTokens: 1,
  });
  assert.equal(estimateCostUsd(2_000_000, 400_000), 0.8);
});

test("the dollar ceiling, not a token ceiling, is what stops a session", () => {
  // If the token ceilings cost less than the dollar ceiling, a session would
  // stop on tokens with budget left — and a specialist or MCP invocation
  // fails outright when it does.
  for (const limits of [OPERATIONS_SESSION_LIMITS, SPECIALIST_SESSION_LIMITS]) {
    assert.ok(
      listPriceAtCeiling(limits) >= limits.maxTokenCostUsdPerSession,
      `token ceilings cost $${listPriceAtCeiling(limits).toFixed(2)}, below the $${limits.maxTokenCostUsdPerSession} ceiling`,
    );
  }
});

test("a specialist can finish inside what its parent has left", () => {
  assert.ok(
    SPECIALIST_SESSION_LIMITS.maxTokenCostUsdPerSession
      < OPERATIONS_SESSION_LIMITS.maxTokenCostUsdPerSession,
  );
});
