import assert from "node:assert/strict";
import { test } from "vitest";
import {
  getEveSessionIdFromRequest,
  isAgentFeatureEnabled,
} from "@/agent/lib/session-identity";
import {
  SESSION_OWNER_WAIT_BUDGET_MS,
  waitForOwnedAgentSession,
} from "@/agent/lib/session-owner";

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

test("waits for a new session ownership row before rejecting the stream", async () => {
  let reads = 0;
  const owner = await waitForOwnedAgentSession(
    async () => {
      reads += 1;
      return reads < 3 ? null : "user_123";
    },
    "wrun_123",
    "user_123",
  );

  assert.equal(owner, true);
  assert.equal(reads, 3);
});

test("keeps waiting through a cold start longer than a few seconds", async () => {
  // The first event of a cold session landed after ~2.7s on staging, which
  // used to refuse the stream of a message that was already running.
  let elapsed = 0;
  const owner = await waitForOwnedAgentSession(
    async () => (elapsed < 9_000 ? null : "user_123"),
    "wrun_123",
    "user_123",
    async (ms) => {
      elapsed += ms;
    },
  );

  assert.equal(owner, true);
});

test("gives up on a session that never registers, within the budget", async () => {
  let elapsed = 0;
  const owner = await waitForOwnedAgentSession(
    async () => null,
    "wrun_123",
    "user_123",
    async (ms) => {
      elapsed += ms;
    },
  );

  assert.equal(owner, false);
  assert.equal(elapsed, SESSION_OWNER_WAIT_BUDGET_MS);
  assert.ok(SESSION_OWNER_WAIT_BUDGET_MS >= 10_000);
  assert.ok(SESSION_OWNER_WAIT_BUDGET_MS <= 20_000);
});

test("rejects a known foreign session without waiting", async () => {
  let reads = 0;
  const owner = await waitForOwnedAgentSession(
    async () => {
      reads += 1;
      return "user_other";
    },
    "wrun_123",
    "user_123",
  );

  assert.equal(owner, false);
  assert.equal(reads, 1);
});
