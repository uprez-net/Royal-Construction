import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

const sdk = vi.hoisted(() => {
  type Snapshot = {
    tags: Record<string, string>;
    contexts: Record<string, unknown>;
    user: unknown;
    level: unknown;
    fingerprint: unknown;
  };
  const current: Snapshot = {
    tags: {},
    contexts: {},
    user: undefined,
    level: undefined,
    fingerprint: undefined,
  };
  const scope = {
    setTag(key: string, value: string) {
      current.tags[key] = value;
    },
    setContext(key: string, value: unknown) {
      current.contexts[key] = value;
    },
    setUser(value: unknown) {
      current.user = value;
    },
    setLevel(value: unknown) {
      current.level = value;
    },
    setFingerprint(value: unknown) {
      current.fingerprint = value;
    },
  };
  const captured: Array<{ error: unknown; scope: Snapshot }> = [];
  return {
    captured,
    captureException: vi.fn((error: unknown) => {
      captured.push({
        error,
        scope: { ...current, tags: { ...current.tags } },
      });
    }),
    withScope: vi.fn((callback: (s: typeof scope) => void) => {
      current.tags = {};
      current.contexts = {};
      current.user = undefined;
      current.level = undefined;
      current.fingerprint = undefined;
      callback(scope);
    }),
    flush: vi.fn(async () => true),
    captureCheckIn: vi.fn(() => "check-in-id"),
  };
});

vi.mock("@sentry/core", () => sdk);

import {
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { reportExternalError } from "@/lib/observability/external";
import { reportError } from "@/lib/observability/report-error";

beforeEach(() => {
  sdk.captured.length = 0;
  sdk.captureException.mockClear();
});

function failure(status: number, message = "x") {
  return Object.assign(new Error(message), { status });
}

describe("reportError", () => {
  test("sends an unexpected failure with its source, ids and user", () => {
    reportError(new Error("db down"), {
      source: "route:POST /api/leads",
      userId: "user_1",
      ids: { leadId: "lead_9", projectId: undefined, n: 4 },
    });
    assert.equal(sdk.captured.length, 1);
    const { scope } = sdk.captured[0];
    assert.equal(scope.tags.source, "route:POST /api/leads");
    assert.equal(scope.tags.explicit, "1");
    assert.deepEqual(scope.user, { id: "user_1" });
    assert.deepEqual(scope.contexts.ids, { leadId: "lead_9", n: 4 });
    assert.equal(scope.level, "error");
  });

  test("a refusal is dropped, so a catch block need not classify first", () => {
    reportError(new DomainValidationError("no"), { source: "route:x" });
    reportError(failure(404), { source: "x" });
    assert.equal(sdk.captured.length, 0);
  });

  test("the same error reported twice is sent once", () => {
    const error = new Error("boom");
    reportError(error, { source: "route:a" });
    reportError(error, { source: "route:b" });
    assert.equal(sdk.captured.length, 1);
  });

  test("never throws into the request that is already failing", () => {
    sdk.withScope.mockImplementationOnce(() => {
      throw new Error("sdk exploded");
    });
    assert.doesNotThrow(() => reportError(new Error("x"), { source: "s" }));
  });
});

describe("reportExternalError — one outage, one issue", () => {
  test("a 503 from Graph is tagged and grouped by service, operation and status", () => {
    reportExternalError("graph", "sendMail", failure(503));
    const { scope } = sdk.captured[0];
    assert.equal(scope.tags.service, "graph");
    assert.equal(scope.tags.operation, "sendMail");
    assert.equal(scope.tags.upstream_status, "503");
    assert.deepEqual(scope.fingerprint, [
      "external",
      "graph",
      "sendMail",
      "503",
    ]);
  });

  test("different callers, same outage, same fingerprint", () => {
    reportExternalError("graph", "sendMail", failure(503, "from route A"));
    reportExternalError("graph", "sendMail", failure(503, "from cron B"));
    assert.deepEqual(
      sdk.captured[0].scope.fingerprint,
      sdk.captured[1].scope.fingerprint,
    );
  });

  test("a call that got no answer is reported", () => {
    reportExternalError(
      "docusign",
      "createEnvelope",
      new Error("fetch failed"),
    );
    assert.equal(sdk.captured[0].scope.tags.upstream_status, "no-response");
  });

  test("an expired credential (401) is reported", () => {
    reportExternalError("xero", "getContext", failure(401));
    assert.equal(sdk.captured.length, 1);
  });

  test("a provider rejecting one request (400, 404, 422) is not", () => {
    for (const status of [400, 404, 422]) {
      reportExternalError("graph", "getMessage", failure(status));
    }
    assert.equal(sdk.captured.length, 0);
  });

  test("a side-effect failure that wraps an outage is reported", () => {
    reportExternalError(
      "graph",
      "sendMail",
      new DomainSideEffectError("not sent", "email"),
    );
    assert.equal(sdk.captured.length, 1);
  });
});
