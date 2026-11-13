// What of a Xero failure may leave this process.
//
// `xero-node` does not reject with an Error. Its generated methods reject with
// `JSON.stringify({ response: { statusCode, body, headers, request }, body })`:
// a plain string holding the whole response body, which for a validation error
// is the values that were submitted (contact names, line items, amounts), and the
// request, whose headers carry the access token as `Authorization: Bearer …`.
//
// None of that is needed to act on the failure. This keeps the HTTP status, so
// the usual 4xx rule still applies, and Xero's own error type
// (`ValidationException`), which names what went wrong without saying what was
// submitted. Pure, with no imports.

interface XeroRejection {
  response?: { statusCode?: unknown; body?: { Type?: unknown } | null };
  statusCode?: unknown;
  body?: { Type?: unknown } | null;
}

function parse(rejection: unknown): XeroRejection | undefined {
  if (typeof rejection === "string") {
    try {
      const value: unknown = JSON.parse(rejection);
      return typeof value === "object" && value !== null
        ? (value as XeroRejection)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof rejection === "object" && rejection !== null
    ? (rejection as XeroRejection)
    : undefined;
}

function statusOf(value: XeroRejection | undefined): number | undefined {
  const status = value?.response?.statusCode ?? value?.statusCode;
  return typeof status === "number" && status >= 100 && status <= 599
    ? status
    : undefined;
}

// Xero's error types are short identifiers. Anything else is not trusted to be
// free of submitted content.
const SAFE_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function typeOf(value: XeroRejection | undefined): string | undefined {
  const type = value?.response?.body?.Type ?? value?.body?.Type;
  return typeof type === "string" && SAFE_TYPE.test(type) ? type : undefined;
}

/**
 * A stand-in for a Xero rejection: `XeroApiError: Xero createInvoices failed:
 * HTTP 400 (ValidationException)`, carrying `status`. A real `Error` (a dropped
 * connection, a timeout) holds no response body and passes through untouched.
 * Never throws, and never returns anything built from the rejection's content.
 */
export function summariseXeroFailure(
  rejection: unknown,
  operation: string,
): unknown {
  if (rejection instanceof Error) return rejection;

  const parsed = parse(rejection);
  const status = statusOf(parsed);
  const type = typeOf(parsed);
  const error = new Error(
    `Xero ${operation} failed${status ? `: HTTP ${status}` : ""}${
      type ? ` (${type})` : ""
    }`,
  );
  error.name = "XeroApiError";
  if (status) Object.assign(error, { status });
  return error;
}
