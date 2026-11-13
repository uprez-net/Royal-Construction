// Reports a failed DocuSign API call, whichever of the dozen call sites made it.
//
// Every DocuSign call in this app — creating an offer or contract envelope,
// reading its status, downloading the executed document, voiding it — ends in
// the SDK's `ApiClient.callApi`. Wrapping that one method reports them all,
// named by the REST route template (`POST /v2.1/accounts/{accountId}/envelopes`)
// rather than the URL, so an event carries no envelope or account id and an
// outage on one endpoint groups into one issue.
//
// Structural on purpose: it needs only a `callApi`, so it is testable without
// the SDK and cannot drift from a type the SDK does not export.

import { reportExternalError } from "@/lib/observability/external";

type CallApi = (
  path: string,
  httpMethod: string,
  ...rest: unknown[]
) => unknown;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Mutates and returns the client. A caller still gets the SDK's own promise and
 * its own rejection; the report is a side channel.
 *
 * Only the promise form is watched — the SDK returns a promise when no callback
 * is given, which is how every call here is made.
 */
export function instrumentDocusignApiClient<
  T extends { callApi: (...args: never[]) => unknown },
>(client: T): T {
  const original = client.callApi.bind(client) as unknown as CallApi;
  const wrapped: CallApi = (path, httpMethod, ...rest) => {
    const result = original(path, httpMethod, ...rest);
    if (isThenable(result)) {
      result.then(undefined, (error: unknown) =>
        reportExternalError(
          "docusign",
          `${String(httpMethod).toUpperCase()} ${path}`,
          error,
        ),
      );
    }
    return result;
  };
  client.callApi = wrapped as unknown as T["callApi"];
  return client;
}
