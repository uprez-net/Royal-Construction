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
  | "mistral"
  | "google"
  | "geoscape"
  | "clerk";

export interface ExternalFailureContext {
  /**
   * The operation IS the credential (a token grant or refresh), so any failure
   * counts, including a 400 — DocuSign answers a revoked consent that way.
   */
  force?: boolean;
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
 *
 * Returns whether anything was reported, so a caller that reported a stand-in
 * for the error (see `summarise` in instrument.ts) can mark the original.
 */
export function reportExternalError(
  service: ExternalService,
  operation: string,
  error: unknown,
  context: ExternalFailureContext = {},
): boolean {
  try {
    const { force, ...rest } = context;
    if (
      wasReported(error)
      || !isReportableExternalFailure(error, { anyStatus: force })
    ) {
      return false;
    }
    const status = errorStatus(error);
    captureWithContext(error, {
      source: `external:${service}.${operation}`,
      tags: {
        // `vendor`, not `service`: every event already carries `service` as the
        // process that raised it (`app` or `eve`), and a second meaning under
        // the same key would overwrite it on exactly these events.
        vendor: service,
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
      ...rest,
    });
    return true;
  } catch {
    // Reporting never throws into the caller.
    return false;
  }
}
