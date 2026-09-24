import assert from "node:assert/strict";
import { test } from "vitest";

import { createFixedWindowRateLimiter } from "@/lib/http/rate-limit";

// The limiter guards public routes keyed by a header the caller controls, so
// its table has to stay bounded however many addresses it is shown.

function counted(options: { limit: number; windowMs: number; maxBuckets?: number }) {
  let clock = 0;
  const limiter = createFixedWindowRateLimiter({ ...options, now: () => clock });
  return {
    allow: (key: string) => limiter.allow(key),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("a window limits one address and resets once it expires", () => {
  const limiter = counted({ limit: 2, windowMs: 1_000 });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  limiter.advance(1_000);
  assert.equal(limiter.allow("a"), true);
});

test("at the cap the oldest address is evicted, not the newest refused", () => {
  const limiter = counted({ limit: 1, maxBuckets: 2, windowMs: 1_000 });
  assert.equal(limiter.allow("a"), true);
  limiter.advance(1);
  assert.equal(limiter.allow("b"), true);
  limiter.advance(1);
  // A third address evicts "a", the oldest window.
  assert.equal(limiter.allow("c"), true);
  assert.equal(limiter.allow("b"), false);
  assert.equal(limiter.allow("c"), false);
  // "a" was forgotten, so it starts a fresh window (and evicts "b").
  assert.equal(limiter.allow("a"), true);
});

test("expired windows are swept, so they do not count toward the cap", () => {
  const limiter = counted({ limit: 1, maxBuckets: 2, windowMs: 1_000 });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("b"), true);
  limiter.advance(1_000);
  // Both expired windows are dropped, so "c" and "d" fit without evicting
  // each other and each keeps its own limit.
  assert.equal(limiter.allow("c"), true);
  assert.equal(limiter.allow("d"), true);
  assert.equal(limiter.allow("c"), false);
  assert.equal(limiter.allow("d"), false);
});
