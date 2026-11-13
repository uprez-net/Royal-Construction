import assert from "node:assert/strict";
import { test } from "vitest";

import { createThrottle } from "@/lib/observability/throttle";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

test("the same error is allowed up to the limit, then dropped", () => {
  const time = clock();
  const throttle = createThrottle({ max: 3, windowMs: 1000, now: time.now });
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(() => throttle.allow("graph:500")),
    [true, true, true, false, false],
  );
});

test("a different error is not affected by a noisy one", () => {
  const throttle = createThrottle({ max: 1, windowMs: 1000, now: clock().now });
  assert.equal(throttle.allow("noisy"), true);
  assert.equal(throttle.allow("noisy"), false);
  assert.equal(throttle.allow("other"), true);
});

test("the window reopens, so a still-broken thing is heard from again", () => {
  const time = clock();
  const throttle = createThrottle({ max: 1, windowMs: 1000, now: time.now });
  assert.equal(throttle.allow("k"), true);
  assert.equal(throttle.allow("k"), false);
  time.advance(1000);
  assert.equal(throttle.allow("k"), true);
});

test("a long-lived instance does not grow the table without bound", () => {
  const time = clock();
  const throttle = createThrottle({ max: 1, windowMs: 1000, now: time.now });
  for (let i = 0; i < 600; i += 1) throttle.allow(`k${i}`);
  time.advance(2000);
  // Expired keys are swept on the next insert; the old ones are allowed anew.
  assert.equal(throttle.allow("fresh"), true);
  assert.equal(throttle.allow("k0"), true);
});
