// Which errors are worth an email, and which are the app working as designed.
//
// The office wants to hear about internal server errors and failures of the
// services this app depends on. A refused request (400, 401, 403, 404, 409) is
// the app doing its job, and mailing about it would teach people to ignore the
// inbox before the first real outage.
//
// Pure: no Sentry, no Next, so the rules are testable and the browser bundle
// can use them.

import { isDomainError } from "@/lib/domain/errors";

/**
 * A `DomainError` the app raised on purpose to say no (400, 403, 404, 409).
 *
 * NOT `DomainSideEffectError`, which carries 502 and means "the command could
 * not do the outside thing" — the email that was never sent, the envelope
 * DocuSign refused. Its own docs call that the expensive failure here, so it
 * must stay reportable even though it is typed.
 */
function isRefusal(error: unknown): boolean {
  return isDomainError(error) && error.status < 500;
}

/** Property a reported error carries so a second path does not report it again. */
const REPORTED = Symbol.for("royal.observability.reported");

/**
 * The HTTP status an error carries, if any. Graph's `GraphRequestError`,
 * DocuSign/Xero SDK errors and `fetch` wrappers all put it in a slightly
 * different place.
 */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown } | null;
  };
  for (const value of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status,
    candidate.response?.statusCode,
  ]) {
    if (typeof value === "number" && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

// Node writes its own process warnings with `console.error`, as one string:
// "(node:7) ExperimentalWarning: …". Console capture sends that as an event, so
// a runtime detail (a vm flag a dependency uses on every workflow step) read as
// an application error and was 142 of 174 events in its first two days.
// Node also prints a bracketed code before the name of a coded warning
// ("(node:7) [DEP0005] DeprecationWarning: …"), and a plain `process.emitWarning`
// is just "Warning" with no prefix on the name.
const NODE_PROCESS_WARNING = /^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?\w*Warning: /;

/**
 * Text that is a Node process warning (`ExperimentalWarning`,
 * `DeprecationWarning`, `MaxListenersExceededWarning`), not a fault in this app.
 * The caller must also know it is not a real `Error` — see `beforeSend`.
 */
export function isNodeProcessWarning(text: string | undefined): boolean {
  return typeof text === "string" && NODE_PROCESS_WARNING.test(text);
}

// Next throws these to steer rendering (`redirect()`, `notFound()`, a dynamic
// bailout). They are control flow that happens to travel as an exception.
const NEXT_CONTROL_FLOW_DIGESTS = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
  "DYNAMIC_SERVER_USAGE",
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "NEXT_PRERENDER_INTERRUPTED",
];

function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { digest, message } = error as { digest?: unknown; message?: unknown };
  if (typeof digest === "string") {
    return NEXT_CONTROL_FLOW_DIGESTS.some((code) => digest.startsWith(code));
  }
  return (
    typeof message === "string"
    && NEXT_CONTROL_FLOW_DIGESTS.some((code) => message === code)
  );
}

/**
 * True for an error that is a refusal or control flow, not a fault.
 *
 * - a `DomainError` that refuses (400, 403, 404, 409) — but not the 502
 *   `DomainSideEffectError`, which is a real failure
 * - a validation failure (`ZodError`)
 * - anything carrying a 4xx status
 * - Next's redirect / not-found / dynamic-bailout signals
 * - an aborted request (the caller went away)
 */
export function isExpectedError(error: unknown): boolean {
  if (isRefusal(error)) return true;
  if (isNextControlFlow(error)) return true;
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === "ZodError" || name === "AbortError") return true;
  }
  const status = errorStatus(error);
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Whether a failure of an outside service is worth reporting.
 *
 * Wider than `isExpectedError` in one place: a 401 or 403 from Graph, DocuSign
 * or Xero is not the user's mistake, it is OUR credential having expired or
 * been revoked — the failure that otherwise shows up as a client asking why
 * they never heard back. Other 4xx answers are the provider rejecting one
 * request and stay quiet. No status at all means the call never got an answer
 * (reset, DNS, timeout), which is exactly what an outage looks like.
 */
export function isReportableExternalFailure(
  error: unknown,
  options: { anyStatus?: boolean } = {},
): boolean {
  if (isRefusal(error)) return false;
  if (isNextControlFlow(error)) return false;
  if (
    typeof error === "object"
    && error !== null
    && (error as { name?: unknown }).name === "AbortError"
  ) {
    return false;
  }
  // An operation that IS the credential (DocuSign's JWT grant, Xero's token
  // refresh) fails with a 400 when consent is revoked or a key is rotated, and
  // that is our configuration breaking, not a client's bad request.
  if (options.anyStatus) return true;
  const status = errorStatus(error);
  if (status === undefined) return true;
  return status >= 500 || status === 401 || status === 403;
}

/**
 * Next gives an error a `digest` when it originated on the server. Such an error
 * has already been reported there with its real message and stack; the copy an
 * error boundary receives in the browser is a redacted stub, so reporting it
 * again only makes a second, useless issue.
 */
export function isServerOriginError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && typeof (error as { digest?: unknown }).digest === "string"
  );
}

/**
 * The HTTP status of a vendor error that reached us as text rather than as an
 * `Error`. `xero-node` rejects with a JSON string, and a caller's
 * `console.error("…", rejection)` joins every argument into one message, so by
 * the time it is an event the status can only be read out of the string.
 */
export function embeddedVendorStatus(
  text: string | undefined,
): number | undefined {
  if (typeof text !== "string") return undefined;
  const match = /\{"response":\{"statusCode":(\d{3})/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** True once a reporting path has taken this error. */
export function wasReported(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as Record<symbol, unknown>)[REPORTED] === true;
}

/** Marks an error so another path (console capture, a retry) skips it. */
export function markReported(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  try {
    Object.defineProperty(error, REPORTED, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // A frozen error cannot be marked; the worst case is one duplicate event.
  }
}
