import assert from "node:assert/strict";
import * as sdk from "@vercel/blob";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({
  calls: [] as Array<{
    service: string;
    operation: string;
    error: unknown;
    context: Record<string, unknown> | undefined;
  }>,
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (
    service: string,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => {
    reported.calls.push({ service, operation, error, context });
  },
}));

import { isReportableBlobFailure, put } from "@/lib/blob";

const saved = process.env.BLOB_READ_WRITE_TOKEN;
beforeEach(() => {
  reported.calls.length = 0;
  Reflect.deleteProperty(process.env, "BLOB_READ_WRITE_TOKEN");
});
afterEach(() => {
  if (saved === undefined)
    Reflect.deleteProperty(process.env, "BLOB_READ_WRITE_TOKEN");
  else process.env.BLOB_READ_WRITE_TOKEN = saved;
});

// The SDK's error classes take different constructor arguments; none matter here.
const make = (ErrorClass: unknown) =>
  new (ErrorClass as new (...args: unknown[]) => Error)();

describe("isReportableBlobFailure — the store or our credential, not a refused request", () => {
  // Blob's errors carry no HTTP status, so the generic "5xx or 401" rule cannot
  // tell a lookup of a file that is not there (harmless) from a suspended store
  // (every upload fails). The SDK's own classes can.
  const refused = [
    ["a file that is not there", sdk.BlobNotFoundError],
    ["a name that does not match", sdk.BlobPathnameMismatchError],
    ["a file that is too large", sdk.BlobFileTooLargeError],
    ["a type that is not allowed", sdk.BlobContentTypeNotAllowedError],
    ["an expired client token", sdk.BlobClientTokenExpiredError],
    ["a failed precondition", sdk.BlobPreconditionFailedError],
    ["an aborted request", sdk.BlobRequestAbortedError],
    ["a rate limit", sdk.BlobServiceRateLimited],
  ] as const;

  for (const [what, ErrorClass] of refused) {
    test(`${what} is not reported`, () => {
      assert.equal(isReportableBlobFailure(make(ErrorClass)), false);
    });
  }

  const faults = [
    ["no access: our token", sdk.BlobAccessError],
    ["a store that does not exist", sdk.BlobStoreNotFoundError],
    ["a suspended store (billing)", sdk.BlobStoreSuspendedError],
    ["the service being down", sdk.BlobServiceNotAvailable],
    ["an unknown failure", sdk.BlobUnknownError],
  ] as const;

  for (const [what, ErrorClass] of faults) {
    test(`${what} is reported`, () => {
      assert.equal(isReportableBlobFailure(make(ErrorClass)), true);
    });
  }

  test("anything that is not a Blob error is reported: a dropped connection", () => {
    assert.equal(isReportableBlobFailure(new TypeError("fetch failed")), true);
    assert.equal(isReportableBlobFailure("a thrown string"), true);
  });
});

describe("lib/blob wraps the SDK without changing what the caller gets", () => {
  test("a failing call is reported as the blob vendor, with any status counting", async () => {
    // No token set: the SDK rejects locally, without touching the network, with
    // the base BlobError ("No blob credentials found") — our configuration.
    const error = await put("a.txt", "x", { access: "public" }).catch(
      (e: unknown) => e,
    );
    assert.ok(error instanceof sdk.BlobError);
    assert.equal(reported.calls.length, 1);
    assert.equal(reported.calls[0].service, "blob");
    assert.equal(reported.calls[0].operation, "put");
    assert.deepEqual(reported.calls[0].context, { force: true });
    assert.equal(reported.calls[0].error, error, "the very same error object");
  });

  test("a refused request is rejected to the caller but not reported", async () => {
    const wrapped = await import("@/lib/blob");
    const refusal = new sdk.BlobNotFoundError();
    // A function that rejects like head() does for a missing file, through the
    // same wrapper machinery lib/blob uses.
    const { instrumentFunction } =
      await import("@/lib/observability/instrument");
    const head = instrumentFunction(
      "blob",
      "head",
      () => async () => {
        throw refusal;
      },
      { shouldReport: wrapped.isReportableBlobFailure },
    );
    await assert.rejects(() => head(), refusal);
    assert.equal(reported.calls.length, 0);
  });
});
