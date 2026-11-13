import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  captureException: vi.fn(),
  withScope: vi.fn((callback: (scope: unknown) => void) =>
    callback({
      setTag() {},
      setContext() {},
      setUser() {},
      setLevel() {},
      setFingerprint() {},
    }),
  ),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/core", () => sdk);

import {
  captureWithContext,
  observeCaptures,
} from "@/lib/observability/report-error";
import {
  noteCaptured,
  trackCaptures,
  trackConsoleErrors,
} from "@/lib/observability/run-context";

const WRAPPED = Symbol.for("royal.observability.console-error-tracked");
const originalConsoleError = console.error;
const received: unknown[][] = [];

beforeAll(() => {
  // Stand in for whatever console.error was: a recorder, so the test can see
  // what reached it, then install the tracker on top.
  console.error = (...args: unknown[]) => void received.push(args);
  Reflect.deleteProperty(console, WRAPPED);
  trackConsoleErrors();
});
afterAll(() => {
  console.error = originalConsoleError;
  Reflect.deleteProperty(console, WRAPPED);
  observeCaptures(() => {});
});

// This is the property an end-to-end run found missing. The SDK delivers an
// event to `beforeSend` after the handler has returned, so a cron wrapper that
// waited for that looked too early and reported a failure twice. These are
// noted at the call.
describe("a run knows, immediately, that an error was logged", () => {
  test("a console.error inside the run is counted before the next line runs", async () => {
    const count = await trackCaptures(async (run) => {
      console.error("[CRON_ERROR] cleanup failed:", new Error("boom"));
      return run.captured;
    });
    assert.equal(count, 1);
  });

  test("it counts each call, and an error with no message", async () => {
    const count = await trackCaptures(async (run) => {
      console.error("a");
      console.error("b", new Error("c"));
      console.error();
      return run.captured;
    });
    assert.equal(count, 3);
  });

  test("a console.error outside any run is passed through and counted nowhere", () => {
    received.length = 0;
    assert.doesNotThrow(() => console.error("outside", { a: 1 }));
    assert.deepEqual(received, [["outside", { a: 1 }]]);
  });

  test("the call reaches whatever was listening, with the same arguments", async () => {
    received.length = 0;
    const error = new Error("boom");
    const payload = { id: 7 };
    await trackCaptures(async () => console.error("msg", payload, error));
    assert.equal(received.length, 1);
    assert.equal(received[0][1], payload);
    assert.equal(received[0][2], error);
  });

  test("installing it twice does not double-count", async () => {
    trackConsoleErrors();
    trackConsoleErrors();
    const count = await trackCaptures(async (run) => {
      console.error("once");
      return run.captured;
    });
    assert.equal(count, 1);
  });

  test("two runs in flight at once keep separate counts", async () => {
    const results = await Promise.all([
      trackCaptures(async (run) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        console.error("noisy run");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return run.captured;
      }),
      trackCaptures(async (run) => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return run.captured;
      }),
    ]);
    assert.deepEqual(results, [1, 0]);
  });

  test("noteCaptured outside a run is harmless", () => {
    assert.doesNotThrow(() => noteCaptured());
  });
});

describe("an explicit report is noted synchronously too", () => {
  test("observeCaptures is called as the report is made, before it returns", () => {
    let seen = 0;
    observeCaptures(() => {
      seen += 1;
    });
    captureWithContext(new Error("boom"), { source: "test" });
    assert.equal(seen, 1);
    assert.equal(sdk.captureException.mock.calls.length >= 1, true);
  });

  test("an observer that throws does not stop the report", () => {
    sdk.captureException.mockClear();
    observeCaptures(() => {
      throw new Error("observer broke");
    });
    assert.doesNotThrow(() =>
      captureWithContext(new Error("still sent"), { source: "test" }),
    );
    assert.equal(sdk.captureException.mock.calls.length, 1);
  });

  test("a report made inside a run is counted against that run", async () => {
    observeCaptures(noteCaptured);
    const count = await trackCaptures(async (run) => {
      captureWithContext(new Error("explicit"), { source: "test" });
      return run.captured;
    });
    assert.equal(count, 1);
  });
});
