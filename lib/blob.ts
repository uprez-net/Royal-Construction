// Vercel Blob, with failures reported.
//
// Every file this app stores — contracts archived after signing, certifier and
// tradie attachments, invoices, offer images — goes through Blob. A failed
// `put` is a document the client was told was saved and was not, and with no
// status code on Blob's errors the generic "5xx / 401" rule cannot tell that
// from a harmless lookup of a file that is not there.
//
// Import from here, not from `@vercel/blob`; `tests/architecture/
// error-reporting.test.ts` fails on a direct import. Types can still come from
// the SDK. Callers keep exactly what they had: the same promise, the same error.

import * as blob from "@vercel/blob";

import { instrumentFunction } from "@/lib/observability/instrument";

/**
 * Whether a Blob failure is the store or our credential failing, as opposed to
 * a request the SDK is right to refuse.
 *
 * Not reported: a file that is not there, a name or type or size the caller got
 * wrong, an expired client token, an aborted request, a rate limit. Reported:
 * no access (our token), a missing or suspended store (config and billing), the
 * service down, an unknown failure, and anything that is not a Blob error at
 * all, such as a dropped connection.
 */
export function isReportableBlobFailure(error: unknown): boolean {
  const expected = [
    blob.BlobNotFoundError,
    blob.BlobPathnameMismatchError,
    blob.BlobFileTooLargeError,
    blob.BlobContentTypeNotAllowedError,
    blob.BlobClientTokenExpiredError,
    blob.BlobPreconditionFailedError,
    blob.BlobRequestAbortedError,
    blob.BlobServiceRateLimited,
  ];
  return !expected.some(
    (errorClass) =>
      typeof errorClass === "function" && error instanceof errorClass,
  );
}

const options = { shouldReport: isReportableBlobFailure };

// `resolve` reads the SDK member at call time, so a module that is only partly
// present (a test double providing `put` and nothing else) fails at the call
// that needs the missing part rather than at import.
export const put = instrumentFunction(
  "blob",
  "put",
  () => blob.put as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.put;

export const del = instrumentFunction(
  "blob",
  "del",
  () => blob.del as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.del;

export const head = instrumentFunction(
  "blob",
  "head",
  () => blob.head as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.head;

export const list = instrumentFunction(
  "blob",
  "list",
  () => blob.list as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.list;

export const get = instrumentFunction(
  "blob",
  "get",
  () => blob.get as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.get;

export const issueSignedToken = instrumentFunction(
  "blob",
  "issueSignedToken",
  () => blob.issueSignedToken as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.issueSignedToken;

export const presignUrl = instrumentFunction(
  "blob",
  "presignUrl",
  () => blob.presignUrl as (...args: unknown[]) => unknown,
  options,
) as unknown as typeof blob.presignUrl;
