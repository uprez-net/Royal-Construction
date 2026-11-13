import assert from "node:assert/strict";
import type { ErrorEvent } from "@sentry/core";
import { describe, test } from "vitest";

import { createBeforeSend } from "@/lib/observability/before-send";
import { embeddedVendorStatus } from "@/lib/observability/filter";
import { redactText } from "@/lib/observability/redact";
import { createThrottle } from "@/lib/observability/throttle";

// How a Xero failure usually reaches an event: not as an Error. `xero-node`
// rejects with a JSON string, the caller does `console.error("[xero] …", it)`,
// and console capture joins every argument into the event message.
function rejection(statusCode: number): string {
  return JSON.stringify({
    response: {
      statusCode,
      body: {
        Type: "ValidationException",
        Elements: [{ Contact: { Name: "Jane Citizen" }, Total: 48250 }],
      },
      request: {
        headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.SECRET-TOKEN" },
      },
    },
  });
}

const consoleMessage = (statusCode: number) =>
  `[xero] Failed to raise a stage claim for project 12: ${rejection(statusCode)}`;

function event(message: string): ErrorEvent {
  return { type: undefined, message } as ErrorEvent;
}

function send(evt: ErrorEvent) {
  const beforeSend = createBeforeSend({
    throttle: createThrottle({ max: 5, windowMs: 60_000 }),
  });
  // A console-captured message has no error to read a status from.
  return beforeSend(evt, { originalException: new Error("synthetic") });
}

describe("embeddedVendorStatus — a status that can only be read out of text", () => {
  test("reads it from a joined console message", () => {
    assert.equal(embeddedVendorStatus(consoleMessage(400)), 400);
    assert.equal(embeddedVendorStatus(consoleMessage(503)), 503);
  });

  test("is undefined for text that is not a vendor error", () => {
    assert.equal(embeddedVendorStatus("db write failed"), undefined);
    assert.equal(embeddedVendorStatus('{"statusCode":400}'), undefined);
    assert.equal(embeddedVendorStatus(undefined), undefined);
  });
});

describe("redactText — a vendor error in text is replaced by its status", () => {
  test("neither the submitted values nor the token survive, and the status does", () => {
    const out = redactText(consoleMessage(400));
    assert.ok(
      out.startsWith("[xero] Failed to raise a stage claim for project 12:"),
    );
    assert.ok(out.endsWith("[vendor error: HTTP 400]"));
    for (const leaked of [
      "Jane Citizen",
      "48250",
      "SECRET-TOKEN",
      "Bearer",
      "ValidationException",
    ]) {
      assert.ok(!out.includes(leaked), `leaked: ${leaked}`);
    }
  });

  test("ordinary text is untouched", () => {
    assert.equal(redactText("lead 41 not found"), "lead 41 not found");
  });
});

describe("beforeSend — a vendor error that arrived as text is never the first report", () => {
  // The Xero hook has already decided: it reports a stand-in for a 5xx, a 401 or
  // a 403, and nothing for another 4xx. The caller's console.error of the raw
  // rejection is the same failure again, with the response body attached.
  test("a 4xx is dropped, as a 4xx Error would be", () => {
    assert.equal(send(event(consoleMessage(400))), null);
    assert.equal(send(event(consoleMessage(404))), null);
    assert.equal(send(event(consoleMessage(429))), null);
  });

  test("a 5xx is dropped: the vendor layer already reported it once, without the body", () => {
    assert.equal(send(event(consoleMessage(500))), null);
    assert.equal(send(event(consoleMessage(503))), null);
  });

  test("a 401 or 403 is dropped for the same reason: that is reported by the vendor layer", () => {
    assert.equal(send(event(consoleMessage(401))), null);
    assert.equal(send(event(consoleMessage(403))), null);
  });

  test("it is dropped whether the text is the message or an exception value", () => {
    const asException = {
      type: undefined,
      exception: { values: [{ type: "Error", value: consoleMessage(503) }] },
    } as ErrorEvent;
    assert.equal(send(asException), null);
  });

  test("an event with no vendor error in it is not affected", () => {
    assert.notEqual(send(event("[CRON_ERROR] cleanup failed")), null);
    assert.notEqual(send(event('db write failed {"statusCode":503}')), null);
  });
});
