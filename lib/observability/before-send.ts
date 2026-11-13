import type { ErrorEvent, EventHint } from "@sentry/core";

import { isExpectedError, markReported, wasReported } from "./filter";
import { redactRecord, redactText } from "./redact";
import { createThrottle, type Throttle } from "./throttle";

/** Tag `reportError` sets so `beforeSend` knows the caller already decided. */
export const EXPLICIT_TAG = "explicit";

// Same error, same place: five an instance every ten minutes is enough to open
// the issue and show it is recurring; the rest only spend quota.
const DEFAULT_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

function throttleKey(event: ErrorEvent): string {
  // A fingerprint is the caller saying what makes this event the same one: an
  // outage grouped by vendor, operation and status. Its message often carries an
  // id or a timestamp that varies per call, and keying on that as well would let
  // one outage slip past the brake as a stream of "different" errors.
  const fingerprint = event.fingerprint?.join("|");
  if (fingerprint) return fingerprint;
  const first = event.exception?.values?.[0];
  return first
    ? `${first.type ?? "Error"}:${(first.value ?? "").slice(0, 120)}`
    : (event.message ?? "").slice(0, 120);
}

function redactEvent(event: ErrorEvent): void {
  if (typeof event.message === "string") {
    event.message = redactText(event.message);
  }
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === "string") value.value = redactText(value.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === "string") {
      crumb.message = redactText(crumb.message);
    }
    // A console breadcrumb carries the raw arguments of the call: whatever
    // object was passed to console.log, a lead record included. They are not
    // text this redactor can walk, and nothing here needs them.
    if (crumb.data && "arguments" in crumb.data) delete crumb.data.arguments;
  }
  if (event.extra) {
    // Console capture puts every argument after the message here, unredacted
    // and not necessarily a string. The message and the error itself already
    // describe the failure; the rest is whatever was in scope at the call.
    const { arguments: _rawArguments, ...rest } = event.extra;
    void _rawArguments;
    event.extra = redactRecord(rest);
  }
  // `reportError({ extra })` lands in the `details` context, not in `extra`.
  // Its strings are redacted the same way; other contexts are left alone.
  const details = event.contexts?.details;
  if (event.contexts && details && typeof details === "object") {
    event.contexts = {
      ...event.contexts,
      details: redactRecord(details as Record<string, unknown>),
    };
  }
  // Names and emails ride in on `user` and `request` by default when PII is on;
  // collection is off (see data-collection.ts), but an explicit user must never
  // carry more than the Clerk id.
  if (event.user) event.user = { id: event.user.id };
}

/**
 * The one gate every event passes before it leaves the process: drop
 * refusals and already-reported errors, strip client details, brake repeats.
 *
 * An event from `reportError` skips the "is this expected" check because the
 * caller made that call with more context than an exception alone has. It is
 * still redacted and still throttled.
 */
export function createBeforeSend(
  options: {
    throttle?: Throttle;
    /**
     * Called once for each event that is about to be sent. The server config
     * uses it to flush after the response, and the cron wrapper to know that
     * something was captured during a run.
     */
    onSent?: () => void;
  } = {},
) {
  const throttle = options.throttle ?? createThrottle(DEFAULT_LIMIT);
  return function beforeSend(
    event: ErrorEvent,
    hint: EventHint,
  ): ErrorEvent | null {
    const original = hint.originalException;
    if (event.tags?.[EXPLICIT_TAG] !== "1") {
      if (wasReported(original)) return null;
      if (isExpectedError(original)) return null;
    }
    redactEvent(event);
    if (!throttle.allow(throttleKey(event))) return null;
    markReported(original);
    try {
      options.onSent?.();
    } catch {
      // A hook must never lose the event it was told about.
    }
    return event;
  };
}
