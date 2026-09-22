import assert from "node:assert/strict";
import { test } from "vitest";

import { GraphRequestError } from "@/lib/graph/client";
import { isRetryableGraphError, withGraphRetry } from "@/lib/graph/retry";

// Every case below runs with baseDelayMs: 0 — the policy under test is which
// failures repeat and how often, not how long the process sleeps.
const NO_WAIT = { baseDelayMs: 0 };

test("a throttle and a bad gateway are worth repeating; a refusal is not", () => {
  assert.equal(
    isRetryableGraphError(new GraphRequestError("throttled", 429)),
    true,
  );
  assert.equal(
    isRetryableGraphError(new GraphRequestError("bad gateway", 502)),
    true,
  );
  assert.equal(
    isRetryableGraphError(new GraphRequestError("timeout", 408)),
    true,
  );

  assert.equal(
    isRetryableGraphError(new GraphRequestError("forbidden", 403)),
    false,
  );
  assert.equal(
    isRetryableGraphError(new GraphRequestError("gone", 404)),
    false,
  );
  assert.equal(
    isRetryableGraphError(new GraphRequestError("too large", 413)),
    false,
  );
});

test("a failure that never got a status is treated as a transport blip", () => {
  // A socket reset or DNS failure carries no status, and those are the retries
  // that pay off most.
  assert.equal(isRetryableGraphError(new Error("fetch failed")), true);
});

test("a transient failure is retried until it succeeds", async () => {
  let calls = 0;
  const result = await withGraphRetry(
    "flaky",
    async () => {
      calls += 1;
      if (calls < 3) throw new GraphRequestError("throttled", 429);
      return "ok";
    },
    NO_WAIT,
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("a permanent failure is not retried and is rethrown", async () => {
  let calls = 0;
  await assert.rejects(
    withGraphRetry(
      "forbidden",
      async () => {
        calls += 1;
        throw new GraphRequestError("Graph error 403", 403);
      },
      NO_WAIT,
    ),
    /Graph error 403/,
  );

  assert.equal(calls, 1);
});

test("the attempt budget is finite and the last error surfaces", async () => {
  let calls = 0;
  await assert.rejects(
    withGraphRetry(
      "always throttled",
      async () => {
        calls += 1;
        throw new GraphRequestError(`attempt ${calls}`, 503);
      },
      { ...NO_WAIT, attempts: 4 },
    ),
    /attempt 4/,
  );

  assert.equal(calls, 4);
});

test("shouldRetry can widen the policy for Graph's indexing lag", async () => {
  // The webhook fetch overrides the default because a 404 straight after a
  // notification means "not indexed yet", not "does not exist".
  let calls = 0;
  const result = await withGraphRetry(
    "fetch message details",
    async () => {
      calls += 1;
      if (calls === 1) throw new GraphRequestError("not found", 404);
      return "message";
    },
    {
      ...NO_WAIT,
      shouldRetry: (error) =>
        isRetryableGraphError(error)
        || (error as { status?: number })?.status === 404,
    },
  );

  assert.equal(result, "message");
  assert.equal(calls, 2);
});

test("Graph's Retry-After wins over our own backoff", async () => {
  // Guessing shorter than Graph asked for is how a throttle becomes a longer
  // throttle, so the wait is the larger of the two.
  const started = Date.now();
  let calls = 0;

  await withGraphRetry(
    "throttled once",
    async () => {
      calls += 1;
      if (calls === 1) throw new GraphRequestError("throttled", 429, 120);
      return "ok";
    },
    NO_WAIT,
  );

  assert.ok(
    Date.now() - started >= 100,
    "should have honoured the 120ms Retry-After despite baseDelayMs: 0",
  );
});

test("a non-Error rejection does not break the retry loop", async () => {
  await assert.rejects(
    withGraphRetry("string throw", async () => Promise.reject("nope"), NO_WAIT),
  );
});
