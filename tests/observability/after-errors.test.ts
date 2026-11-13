import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

import { isExpectedError } from "@/lib/observability/filter";

// What happens to an error thrown inside `after()`.
//
// About twelve places in this app do their work in `after()` (the compliance
// workflows, the Graph and Xero webhooks, the agent-effects route), so a failure
// there happens after the response is sent, with no one waiting on it.
// `onRequestError` does not see it, and the app's own `onTaskError` is a no-op.
// What Next DOES do, in `AfterContext.reportTaskError`, is `console.error` the
// original error, and the server's console capture turns that into an event.
//
// That is a property of Next's internals, not a contract, so it is pinned here
// against the installed version. If an upgrade changes it, this fails and says
// why, instead of failures in `after()` quietly going unreported.

type ReportTaskError = (kind: "function" | "promise", error: unknown) => void;

async function reportTaskError(): Promise<ReportTaskError> {
  const { AfterContext } = await import("next/dist/server/after/after-context");
  // The method uses only `this.onTaskError`; no server is needed to call it.
  const context = Object.create(AfterContext.prototype) as {
    onTaskError?: () => void;
    reportTaskError: ReportTaskError;
  };
  context.onTaskError = () => {};
  return context.reportTaskError.bind(context);
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("Next's after(): a failed task reaches console.error with the original error", () => {
  test("a function passed to after() that throws", async () => {
    const failure = new Error("compliance follow-up failed");
    (await reportTaskError())("function", failure);

    assert.equal(consoleError.mock.calls.length, 1);
    const [message, error] = consoleError.mock.calls[0];
    assert.match(String(message), /function passed to `after\(\)`/);
    assert.equal(
      error,
      failure,
      "the original error object, so Sentry reports its real stack and message",
    );
  });

  test("a promise passed to after() that rejects", async () => {
    const failure = new Error("Graph call rejected");
    (await reportTaskError())("promise", failure);

    const [message, error] = consoleError.mock.calls[0];
    assert.match(String(message), /promise passed to `after\(\)` rejected/);
    assert.equal(error, failure);
  });

  test("a real failure from an after() task is not filtered out as expected", () => {
    // The filter that console capture goes through must keep what a task throws.
    assert.equal(isExpectedError(new Error("graph write failed")), false);
    assert.equal(
      isExpectedError(Object.assign(new Error("x"), { status: 503 })),
      false,
    );
  });
});
