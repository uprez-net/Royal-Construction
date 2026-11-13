import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  errorStatus,
  isExpectedError,
  isReportableExternalFailure,
  isServerOriginError,
  markReported,
  wasReported,
} from "@/lib/observability/filter";

function withStatus(status: number, extra: object = {}) {
  return Object.assign(new Error(`status ${status}`), { status, ...extra });
}

describe("isExpectedError — what the office is NOT emailed about", () => {
  test("a domain refusal is the app working as designed", () => {
    assert.equal(isExpectedError(new DomainValidationError("bad input")), true);
    assert.equal(
      isExpectedError(new DomainNotFoundError("no such lead")),
      true,
    );
  });

  test("a domain side-effect failure is NOT a refusal � it is the email that never went", () => {
    // DomainSideEffectError carries 502 and says the command could not do the
    // outside thing. Its own docs call that the expensive failure here. A
    // blanket "any DomainError is expected" rule would silence it, and the
    // routes that catch it answer and return without logging it.
    const failure = new DomainSideEffectError("Email was not sent.", "email");
    assert.equal(isExpectedError(failure), false);
    assert.equal(isReportableExternalFailure(failure), true);
  });

  test("a validation failure is a 400, not a fault", () => {
    const zod = Object.assign(new Error("invalid"), { name: "ZodError" });
    assert.equal(isExpectedError(zod), true);
  });

  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    test(`an error carrying a ${status} is skipped`, () => {
      assert.equal(isExpectedError(withStatus(status)), true);
    });
  }

  test("a 5xx is a fault and is kept", () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(isExpectedError(withStatus(status)), false);
    }
  });

  test("an error with no status is kept — an unexpected throw is a bug", () => {
    assert.equal(isExpectedError(new TypeError("x is undefined")), false);
    assert.equal(isExpectedError("a thrown string"), false);
    assert.equal(isExpectedError(undefined), false);
  });

  test("Next's redirect and not-found signals are control flow", () => {
    for (const digest of [
      "NEXT_REDIRECT;replace;/sign-in;307;",
      "NEXT_NOT_FOUND",
      "NEXT_HTTP_ERROR_FALLBACK;404",
      "DYNAMIC_SERVER_USAGE",
    ]) {
      assert.equal(
        isExpectedError(Object.assign(new Error("x"), { digest })),
        true,
        digest,
      );
    }
  });

  test("an aborted request means the caller went away", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    assert.equal(isExpectedError(abort), true);
  });
});

describe("errorStatus — where each client puts the status", () => {
  test("reads status, statusCode and a nested response", () => {
    assert.equal(errorStatus({ status: 503 }), 503);
    assert.equal(errorStatus({ statusCode: 502 }), 502);
    assert.equal(errorStatus({ response: { status: 401 } }), 401);
    assert.equal(errorStatus({ response: { statusCode: 500 } }), 500);
  });

  test("ignores values that are not an HTTP status", () => {
    assert.equal(errorStatus({ status: "500" }), undefined);
    assert.equal(errorStatus({ status: 42 }), undefined);
    assert.equal(errorStatus({ status: 0 }), undefined);
    assert.equal(errorStatus(null), undefined);
    assert.equal(errorStatus("500"), undefined);
  });
});

describe("isReportableExternalFailure — an outside service failing", () => {
  test("5xx and no-answer failures are reported: that is an outage", () => {
    assert.equal(isReportableExternalFailure(withStatus(500)), true);
    assert.equal(isReportableExternalFailure(withStatus(503)), true);
    assert.equal(
      isReportableExternalFailure(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      ),
      true,
    );
  });

  test("401 and 403 ARE reported: that is OUR credential expiring", () => {
    // The one place this is wider than isExpectedError, deliberately. A Graph
    // token that lapses is otherwise a client asking why they never heard back.
    assert.equal(isReportableExternalFailure(withStatus(401)), true);
    assert.equal(isReportableExternalFailure(withStatus(403)), true);
    assert.equal(isExpectedError(withStatus(401)), true);
  });

  test("every other 4xx is the provider rejecting one request", () => {
    for (const status of [400, 404, 409, 413, 422, 429]) {
      assert.equal(
        isReportableExternalFailure(withStatus(status)),
        false,
        `${status}`,
      );
    }
  });

  test("a domain refusal is never an outage", () => {
    assert.equal(
      isReportableExternalFailure(new DomainValidationError("x")),
      false,
    );
  });
});

describe("reported marker", () => {
  test("a marked error is recognised, so a second path skips it", () => {
    const error = new Error("boom");
    assert.equal(wasReported(error), false);
    markReported(error);
    assert.equal(wasReported(error), true);
  });

  test("marking a frozen error or a primitive does not throw", () => {
    assert.doesNotThrow(() => markReported(Object.freeze(new Error("x"))));
    assert.doesNotThrow(() => markReported("string"));
    assert.doesNotThrow(() => markReported(undefined));
    assert.equal(wasReported("string"), false);
  });

  test("the marker is not enumerable, so it never leaks into a payload", () => {
    const error = new Error("boom");
    markReported(error);
    assert.deepEqual(Object.keys(error), []);
    assert.equal(JSON.stringify(error), "{}");
  });
});

describe("isServerOriginError", () => {
  test("a digest means the server already reported the real error", () => {
    assert.equal(
      isServerOriginError(Object.assign(new Error("x"), { digest: "123" })),
      true,
    );
  });

  test("an error born in the browser has no digest", () => {
    assert.equal(isServerOriginError(new Error("x")), false);
    assert.equal(isServerOriginError("string"), false);
    assert.equal(isServerOriginError(null), false);
  });
});
