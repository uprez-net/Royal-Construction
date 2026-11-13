import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/observability/report-error", () => ({
  reportError: (...args: unknown[]) => {
    reported.calls.push(args);
  },
}));

import {
  DomainNotFoundError,
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  domainActionFailure,
  domainErrorResponse,
} from "@/lib/http/domain-response";

beforeEach(() => {
  reported.calls.length = 0;
});

// The adapters that call these answer the screen and return — nothing after
// them logs. So the 502 has to be reported here or it is never seen at all.
describe("a domain refusal is answered, a side-effect failure is also reported", () => {
  test("a 400 or 404 refusal is answered and NOT reported", () => {
    domainErrorResponse(new DomainValidationError("bad"));
    domainErrorResponse(new DomainNotFoundError());
    domainActionFailure(new DomainValidationError("bad"));
    assert.equal(reported.calls.length, 0);
  });

  test("the route response still carries the 502 and the message", async () => {
    const response = domainErrorResponse(
      new DomainSideEffectError("The email could not be sent.", "email"),
    );
    assert.ok(response);
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "The email could not be sent.");
  });

  test("a side-effect failure from a route is reported with its port", () => {
    domainErrorResponse(new DomainSideEffectError("not sent", "email", true));
    assert.equal(reported.calls.length, 1);
    const [error, context] = reported.calls[0] as [
      Error,
      { source: string; fingerprint: string[]; extra: { retryable: boolean } },
    ];
    assert.ok(error instanceof DomainSideEffectError);
    assert.equal(context.source, "domain:email");
    assert.deepEqual(context.fingerprint, ["domain-side-effect", "email"]);
    assert.equal(context.extra.retryable, true);
  });

  test("a side-effect failure from a Server Action is reported too", () => {
    const failure = domainActionFailure(
      new DomainSideEffectError("not sent", "docusign"),
    );
    assert.equal(failure?.status, 502);
    assert.equal(reported.calls.length, 1);
  });

  test("something that is not a DomainError is left to the caller", () => {
    assert.equal(domainErrorResponse(new Error("bug")), null);
    assert.equal(domainActionFailure(new Error("bug")), null);
    assert.equal(reported.calls.length, 0);
  });
});
