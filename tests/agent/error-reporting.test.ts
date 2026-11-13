import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const reports = vi.hoisted(() => ({
  errors: [] as Array<{ error: Error; context: Record<string, unknown> }>,
  external: [] as Array<{
    service: string;
    operation: string;
    error: Error;
    context: Record<string, unknown> | undefined;
  }>,
}));
vi.mock("@/lib/observability/report-error", () => ({
  reportError: (error: Error, context: Record<string, unknown>) => {
    reports.errors.push({ error, context });
  },
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (
    service: string,
    operation: string,
    error: Error,
    context?: Record<string, unknown>,
  ) => {
    reports.external.push({ service, operation, error, context });
  },
}));

import { resetInstrumentationHandlers } from "@sentry/core";
import * as Sentry from "@sentry/node";

import {
  eveFailureHandlers,
  failureToError,
  initEveErrorReporting,
} from "@/agent/lib/error-reporting";

beforeEach(() => {
  reports.errors.length = 0;
  reports.external.length = 0;
});

describe("failureToError — Eve hands a failure over as `unknown`", () => {
  test("an Error is kept as it is", () => {
    const error = new Error("boom");
    assert.equal(failureToError(error, "fallback"), error);
  });

  test("a serialised error keeps its name, message, stack and status", () => {
    const error = failureToError(
      {
        name: "GraphRequestError",
        message: "Graph 503",
        stack: "at x",
        status: 503,
      },
      "fallback",
    );
    assert.equal(error.name, "GraphRequestError");
    assert.equal(error.message, "Graph 503");
    assert.equal(error.stack, "at x");
    assert.equal((error as Error & { status: number }).status, 503);
  });

  test("a string becomes the message", () => {
    assert.equal(failureToError("it broke", "fallback").message, "it broke");
  });

  test("no detail at all (output recording off) still yields a reportable error", () => {
    assert.equal(
      failureToError(undefined, "A turn failed.").message,
      "A turn failed.",
    );
    assert.equal(
      failureToError({}, "A turn failed.").message,
      "A turn failed.",
    );
  });
});

describe("failure handlers", () => {
  test("a failed turn is reported with its session and turn ids", () => {
    eveFailureHandlers["turn.failed"]({
      sessionId: "s1",
      turnId: "t1",
      error: new Error("model exploded"),
    });
    assert.equal(reports.errors.length, 1);
    assert.equal(reports.errors[0].context.source, "eve:turn.failed");
    assert.deepEqual(reports.errors[0].context.ids, {
      sessionId: "s1",
      turnId: "t1",
    });
  });

  test("a failed model call is an outside-service failure, not an app error", () => {
    eveFailureHandlers["model.call.failed"]({
      scope: { sessionId: "s1", turnId: "t1" },
      error: { message: "gateway 503", status: 503 },
    });
    assert.equal(reports.errors.length, 0);
    assert.equal(reports.external.length, 1);
    assert.equal(reports.external[0].service, "ai");
    assert.equal(reports.external[0].operation, "model.call");
  });

  test("a failed action is reported; a rejected, cancelled or abandoned one is not", () => {
    eveFailureHandlers["action.failed"]({
      outcome: "failed",
      error: new Error("x"),
    });
    for (const outcome of ["rejected", "cancelled", "abandoned"]) {
      eveFailureHandlers["action.failed"]({ outcome, error: new Error("x") });
    }
    assert.equal(reports.errors.length, 1);
  });

  test("a failed channel delivery and a failed session are reported", () => {
    eveFailureHandlers["channel.delivery.failed"]({
      sessionId: "s1",
      error: new Error("could not deliver"),
    });
    eveFailureHandlers["session.failed"]({ sessionId: "s1" });
    assert.deepEqual(
      reports.errors.map((r) => r.context.source),
      ["eve:channel.delivery.failed", "eve:session.failed"],
    );
  });

  test("retry noise is not subscribed: step.attempt.failed is not a handler", () => {
    // An attempt that fails and is retried is not an incident; the turn,
    // session or action that finally fails is.
    assert.equal("step.attempt.failed" in eveFailureHandlers, false);
  });
});

// The SDK keeps its client on three scopes and its console hooks in a module
// level registry, so a client made by one test is still there for the next. Each
// case below starts from none and leaves none, and makes the client it needs.
async function resetSdk(): Promise<void> {
  await Sentry.getClient()?.close(0);
  Sentry.getGlobalScope().setClient(undefined);
  Sentry.getCurrentScope().setClient(undefined);
  Sentry.getIsolationScope().setClient(undefined);
  resetInstrumentationHandlers();
}

describe("initEveErrorReporting", () => {
  beforeEach(resetSdk);
  afterEach(resetSdk);

  test("starts from no client, so the cases below are not order dependent", () => {
    assert.equal(Sentry.isInitialized(), false);
  });

  test("outside production it starts disabled, so the agent sends nothing", () => {
    initEveErrorReporting();
    assert.equal(Sentry.isInitialized(), true);
    assert.equal(Sentry.getClient()?.getOptions().enabled, false);
  });

  test("calling it again leaves the first client alone", () => {
    initEveErrorReporting();
    const first = Sentry.getClient();
    assert.ok(first, "the first call made a client");
    initEveErrorReporting();
    assert.equal(Sentry.getClient(), first);
  });

  test("a client someone else already made is left alone", () => {
    Sentry.init({ dsn: undefined, enabled: false });
    const theirs = Sentry.getClient();
    initEveErrorReporting();
    assert.equal(Sentry.getClient(), theirs);
  });

  test("it carries the locked-down data policy", () => {
    initEveErrorReporting();
    const options = Sentry.getClient()?.getOptions();
    assert.equal(options?.dataCollection?.httpBodies?.length, 0);
    assert.equal(options?.dataCollection?.cookies, false);
    assert.equal(options?.dataCollection?.stackFrameVariables, false);
  });

  test("it tags every event as coming from the agent, not the app", () => {
    initEveErrorReporting();
    const scope = Sentry.getClient()?.getOptions().initialScope as
      | { tags?: Record<string, string> }
      | undefined;
    assert.equal(scope?.tags?.service, "eve");
  });
});
