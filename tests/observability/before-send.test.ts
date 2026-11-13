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
  beforeSend = createBeforeSend({
    throttle: createThrottle({ max: 5, windowMs: 60_000 }),
  }),
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
    const beforeSend = createBeforeSend({
      throttle: createThrottle({ max: 2, windowMs: 60_000 }),
    });
    const results = [1, 2, 3, 4].map(() =>
      beforeSend(event(), { originalException: new Error("boom") }),
    );
    assert.deepEqual(
      results.map((r) => r !== null),
      [true, true, false, false],
    );
  });

  // Console capture attaches the raw arguments of the call, twice: as
  // `extra.arguments` on the event and as `data.arguments` on the console
  // breadcrumb. Neither is text the redactor can walk, so an object passed to
  // console.error (a lead record, say) would otherwise go out untouched.
  test("the raw console arguments are removed from the event extra", () => {
    const evt = event({
      extra: {
        arguments: [{ name: "Jane Citizen", phone: "0412 345 678" }],
        note: "ring jane@example.com",
      },
    });
    const out = send(evt, new Error("x"));
    assert.ok(out);
    assert.equal("arguments" in (out.extra ?? {}), false);
    assert.equal(
      (out.extra as { note: string }).note,
      "ring [email]",
      "the other extras are kept and redacted",
    );
    assert.ok(!JSON.stringify(out).includes("Jane Citizen"));
  });

  test("the raw arguments of a console breadcrumb are removed, the rest kept", () => {
    const evt = event({
      breadcrumbs: [
        {
          category: "console",
          message: "saving jane@example.com",
          data: {
            arguments: [{ email: "jane@example.com" }],
            logger: "console",
          },
        },
      ],
    });
    const crumb = send(evt, new Error("x"))?.breadcrumbs?.[0];
    assert.ok(crumb);
    assert.equal("arguments" in (crumb.data ?? {}), false);
    assert.equal(crumb.data?.logger, "console");
    assert.equal(crumb.message, "saving [email]");
  });

  test("a breadcrumb with no data is left alone", () => {
    const evt = event({ breadcrumbs: [{ message: "navigated" }] });
    assert.equal(
      send(evt, new Error("x"))?.breadcrumbs?.[0]?.message,
      "navigated",
    );
  });

  test("strings in the `details` context are redacted and other contexts kept", () => {
    const evt = event({
      contexts: {
        details: { note: "reply to jane@example.com", attempts: 3 },
        ids: { leadId: 42 },
      },
    });
    const out = send(evt, new Error("x"));
    assert.deepEqual(out?.contexts?.details, {
      note: "reply to [email]",
      attempts: 3,
    });
    assert.deepEqual(out?.contexts?.ids, { leadId: 42 });
  });

  test("a fingerprinted outage is braked as one, however its message varies", () => {
    // reportExternalError groups by vendor, operation and status, but the
    // message carries a request id. Keyed on the message as well, every call
    // would look new and the brake would never close.
    const beforeSend = createBeforeSend({
      throttle: createThrottle({ max: 2, windowMs: 60_000 }),
    });
    const outage = (id: number) =>
      event({
        fingerprint: ["external", "graph", "sendMail", "503"],
        exception: {
          values: [{ type: "Error", value: `Graph 503 request ${id}` }],
        },
      });
    const sent = [1, 2, 3, 4].map(
      (id) =>
        beforeSend(outage(id), { originalException: new Error(`r${id}`) })
        !== null,
    );
    assert.deepEqual(sent, [true, true, false, false]);
  });

  test("without a fingerprint the message still tells errors apart", () => {
    const beforeSend = createBeforeSend({
      throttle: createThrottle({ max: 1, windowMs: 60_000 }),
    });
    const a = event({ exception: { values: [{ type: "Error", value: "a" }] } });
    const b = event({ exception: { values: [{ type: "Error", value: "b" }] } });
    assert.notEqual(beforeSend(a, { originalException: new Error("a") }), null);
    assert.notEqual(beforeSend(b, { originalException: new Error("b") }), null);
  });

  test("onSent fires for an event that goes out, and not for one that is dropped", () => {
    let sent = 0;
    const beforeSend = createBeforeSend({ onSent: () => (sent += 1) });
    beforeSend(event(), { originalException: new Error("real") });
    beforeSend(event(), { originalException: new DomainValidationError("no") });
    assert.equal(sent, 1);
  });

  test("a hook that throws does not lose the event", () => {
    const beforeSend = createBeforeSend({
      onSent: () => {
        throw new Error("hook broke");
      },
    });
    assert.notEqual(
      beforeSend(event(), { originalException: new Error("real") }),
      null,
    );
  });

  test("distinct errors are not braked by each other", () => {
    const beforeSend = createBeforeSend({
      throttle: createThrottle({ max: 1, windowMs: 60_000 }),
    });
    const a = event({ exception: { values: [{ type: "Error", value: "a" }] } });
    const b = event({ exception: { values: [{ type: "Error", value: "b" }] } });
    assert.notEqual(beforeSend(a, { originalException: new Error("a") }), null);
    assert.notEqual(beforeSend(b, { originalException: new Error("b") }), null);
  });
});
