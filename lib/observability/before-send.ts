import type { ErrorEvent, EventHint } from "@sentry/core";

import {
  embeddedVendorStatus,
  isExpectedError,
  isNodeProcessWarning,
  markReported,
  wasReported,
} from "./filter";
import { redactRecord, redactText } from "./redact";
import { workflowRuntimeFailure } from "./workflow-runtime-failure";
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

/**
 * A vendor error that reached us as text rather than as an `Error`.
 *
 * `xero-node` rejects with a JSON string, and a caller's
 * `console.error("[xero] Failed …", rejection)` joins every argument into the
 * event message, so there is no error object to mark as reported and none to
 * read a status from. But every Xero call goes through the one hooked client
 * (`lib/xero/client.ts`), which has already decided what to do with this failure
 * and reported a stand-in for it if it was worth reporting: a 5xx, a 401 or a 403
 * yes, any other 4xx no. So an event whose text embeds that error is never the
 * first report of it, and sending it too would be a second issue, and a second
 * email, for one failure, carrying the response body the stand-in exists to keep
 * out. Dropped whatever its status.
 */
function isVendorErrorText(event: ErrorEvent): boolean {
  const texts = [
    event.message,
    ...(event.exception?.values ?? []).map((value) => value.value),
  ];
  return texts.some((text) => embeddedVendorStatus(text) !== undefined);
}

/**
 * A Node process warning that console capture turned into an event.
 *
 * Checked on the text, not on the absence of `event.exception`: a message sent
 * with a stack trace still carries a synthetic exception, so the event has one
 * either way. What separates it from a real failure is that there is no `Error`
 * behind it (`original` is undefined for a string `console.error`), so a thrown
 * `Error` that merely quotes a warning is never dropped by this rule. The text
 * still reaches the Vercel logs; only the Sentry copy goes.
 */
function isNodeWarningEvent(event: ErrorEvent, original: unknown): boolean {
  if (original instanceof Error) return false;
  const texts = [
    event.message,
    ...(event.exception?.values ?? []).map((value) => value.value),
  ];
  return texts.some((text) => isNodeProcessWarning(text));
}

/**
 * Turn the Workflow runtime's "[object Object]" failure line into one that says
 * which kind of failure it was and which run, from a validated allow-list (see
 * workflow-runtime-failure.ts). Leaves any other event untouched.
 */
function describeWorkflowRuntimeFailure(event: ErrorEvent): void {
  const failure = workflowRuntimeFailure(
    event.message ?? event.exception?.values?.[0]?.value,
    event.extra?.arguments,
  );
  if (!failure) return;
  const text = `Workflow run failed: ${failure.code} ${failure.name}`;
  event.message = text;
  for (const value of event.exception?.values ?? []) value.value = text;
  // One issue per kind of failure, not one per run.
  event.fingerprint = ["workflow-runtime", failure.code, failure.name];
  event.tags = {
    ...event.tags,
    workflow_error_code: failure.code,
    ...(failure.runId ? { workflow_run_id: failure.runId } : {}),
  };
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
  // A fingerprint is stored with the issue and shown in the UI, and a caller
  // that builds one from a message (the workflow reporter does) can put a
  // recipient's address in it.
  if (event.fingerprint) event.fingerprint = event.fingerprint.map(redactText);
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
      if (isVendorErrorText(event)) return null;
      if (isNodeWarningEvent(event, original)) return null;
    }
    // Before redactEvent deletes the raw console arguments this reads from.
    describeWorkflowRuntimeFailure(event);
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
