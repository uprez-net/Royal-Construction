import assert from "node:assert/strict";
import { test } from "vitest";

import { estimateCostUsd, OPERATIONS_MODEL_PRICING } from "@/lib/agent/model";
import {
  listPriceAtCeiling,
  OPERATIONS_SESSION_LIMITS,
  SPECIALIST_SESSION_LIMITS,
} from "@/lib/agent/session-limits";

test("GLM-5.3-flash is priced at $0.08/M input and $0.25/M output", () => {
  assert.deepEqual(OPERATIONS_MODEL_PRICING, {
    inputUsdPerMillionTokens: 0.08,
    outputUsdPerMillionTokens: 0.25,
  });
  assert.equal(estimateCostUsd(2_000_000, 400_000), 0.26);
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
