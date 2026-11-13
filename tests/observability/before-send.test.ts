import assert from "node:assert/strict";
import type { ErrorEvent } from "@sentry/core";
import { describe, test } from "vitest";

import {
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  createBeforeSend,
  EXPLICIT_TAG,
} from "@/lib/observability/before-send";
import { markReported } from "@/lib/observability/filter";
import { createThrottle } from "@/lib/observability/throttle";

function event(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    exception: { values: [{ type: "Error", value: "boom" }] },
    ...overrides,
  } as ErrorEvent;
}

function send(
  evt: ErrorEvent,
  original: unknown,
  beforeSend = createBeforeSend(createThrottle({ max: 5, windowMs: 60_000 })),
) {
  return beforeSend(evt, { originalException: original });
}

describe("beforeSend — the last gate before an event leaves", () => {
  test("an unexpected exception is sent", () => {
    assert.notEqual(send(event(), new Error("boom")), null);
  });

  test("a refusal that reached console capture is dropped", () => {
    assert.equal(send(event(), new DomainValidationError("no")), null);
    assert.equal(
      send(event(), Object.assign(new Error("x"), { status: 404 })),
      null,
    );
  });

  test("a side-effect failure is sent", () => {
    assert.notEqual(
      send(event(), new DomainSideEffectError("Email was not sent.", "email")),
      null,
    );
  });

  test("an error a reportError call already took is not sent twice", () => {
    // console.error(msg, error) after reportError(error) is the usual way two
    // paths meet. One issue, one email.
    const error = new Error("boom");
    markReported(error);
    assert.equal(send(event(), error), null);
  });

  test("an explicit report skips the 'expected' check but is still gated", () => {
    // reportExternalError decides 401/403 matter though isExpectedError says no.
    const credential = Object.assign(new Error("401"), { status: 401 });
    const evt = event({ tags: { [EXPLICIT_TAG]: "1" } });
    assert.notEqual(send(evt, credential), null);
  });

  test("client details are stripped from the message, breadcrumbs and extra", () => {
    const evt = event({
      exception: {
        values: [{ type: "Error", value: "send to jane@example.com failed" }],
      },
      breadcrumbs: [{ message: "ring 0412 345 678" }],
      extra: { note: "reply-to jane@example.com" },
      message: "Bearer abc.def",
    });
    const out = send(evt, new Error("x"));
    assert.ok(out);
    assert.equal(out.exception?.values?.[0]?.value, "send to [email] failed");
    assert.equal(out.breadcrumbs?.[0]?.message, "ring [phone]");
    assert.equal((out.extra as { note: string }).note, "reply-to [email]");
    assert.equal(out.message, "Bearer [token]");
  });

  test("the user is cut down to the Clerk id", () => {
    const evt = event({
      user: { id: "user_123", email: "jane@example.com", username: "jane" },
    });
    const out = send(evt, new Error("x"));
    assert.deepEqual(out?.user, { id: "user_123" });
  });

  test("a loop is braked so the quota survives it", () => {
    const beforeSend = createBeforeSend(
      createThrottle({ max: 2, windowMs: 60_000 }),
    );
    const results = [1, 2, 3, 4].map(() =>
      beforeSend(event(), { originalException: new Error("boom") }),
    );
    assert.deepEqual(
      results.map((r) => r !== null),
      [true, true, false, false],
    );
  });

  test("distinct errors are not braked by each other", () => {
    const beforeSend = createBeforeSend(
      createThrottle({ max: 1, windowMs: 60_000 }),
    );
    const a = event({ exception: { values: [{ type: "Error", value: "a" }] } });
    const b = event({ exception: { values: [{ type: "Error", value: "b" }] } });
    assert.notEqual(beforeSend(a, { originalException: new Error("a") }), null);
    assert.notEqual(beforeSend(b, { originalException: new Error("b") }), null);
  });
});
