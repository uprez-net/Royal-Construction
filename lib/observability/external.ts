// Report a failure of a service this app depends on, tagged so one outage is one
// issue and one email — not one per request that hit it.

import {
  errorStatus,
  isReportableExternalFailure,
  wasReported,
} from "./filter";
import {
  captureWithContext,
  type ErrorContext,
  type ErrorLevel,
} from "./report-error";

export type ExternalService =
  | "graph"
  | "docusign"
  | "xero"
  | "novu"
  | "blob"
  | "ai"
  | "clerk";

export interface ExternalFailureContext {
  userId?: string;
  ids?: ErrorContext["ids"];
  extra?: ErrorContext["extra"];
  level?: ErrorLevel;
}

/**
 * `operation` names the call (`sendMail`, `createEnvelope`), so the issue reads
 * "graph / sendMail" in the email rather than a bare stack.
 *
 * Reported: a 5xx, a 401/403 (our credential), and a call that got no answer.
 * Not reported: any other 4xx, which is the provider refusing one request.
 */
export function reportExternalError(
  service: ExternalService,
  operation: string,
  error: unknown,
  context: ExternalFailureContext = {},
): void {
  try {
    if (wasReported(error) || !isReportableExternalFailure(error)) return;
    const status = errorStatus(error);
    captureWithContext(error, {
      source: `external:${service}.${operation}`,
      tags: {
        service,
        operation,
        upstream_status: status ?? "no-response",
      },
      // The stack differs per caller; the outage does not. Group on the thing
      // that is actually down.
      fingerprint: [
        "external",
        service,
        operation,
        String(status ?? "no-response"),
      ],
      ...context,
    });
  } catch {
    // Reporting never throws into the caller.
  }
}
