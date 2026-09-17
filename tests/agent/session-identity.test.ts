import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getEveSessionIdFromRequest,
  isAgentFeatureEnabled,
} from "../../agent/lib/session-identity";

test("extracts session IDs from send, stream, and control routes", () => {
  for (const path of [
    "/eve/v1/session/wrun_123",
    "/eve/v1/session/wrun_123/stream",
    "/_eve_internal/eve/eve/v1/session/wrun_123/cancel",
  ]) {
    assert.equal(
      getEveSessionIdFromRequest(new Request(`https://example.test${path}`)),
      "wrun_123",
    );
  }
});

test("does not invent a session ID for create or inspection routes", () => {
  assert.equal(
    getEveSessionIdFromRequest(
      new Request("https://example.test/eve/v1/session"),
    ),
    null,
  );
  assert.equal(
    getEveSessionIdFromRequest(new Request("https://example.test/eve/v1/info")),
    null,
  );
});

test("the rollout flag is fail closed", () => {
  assert.equal(isAgentFeatureEnabled(undefined), false);
  assert.equal(isAgentFeatureEnabled("false"), false);
  assert.equal(isAgentFeatureEnabled("TRUE"), false);
  assert.equal(isAgentFeatureEnabled("true"), true);
});
