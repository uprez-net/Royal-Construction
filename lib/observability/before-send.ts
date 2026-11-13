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
  const first = event.exception?.values?.[0];
  const fingerprint = event.fingerprint?.join("|");
  const head = first
    ? `${first.type ?? "Error"}:${(first.value ?? "").slice(0, 120)}`
    : (event.message ?? "").slice(0, 120);
  return fingerprint ? `${fingerprint}::${head}` : head;
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
  }
  if (event.extra) event.extra = redactRecord(event.extra);
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
  throttle: Throttle = createThrottle(DEFAULT_LIMIT),
) {
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
    return event;
  };
}
