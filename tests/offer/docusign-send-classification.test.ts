import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isDocusignTransportFailure,
  resolveEnvelopeCreateError,
} from "@/lib/docusign/envelope-send-attempt";

// #289: a send whose outcome the app cannot see. Getting this classification
// wrong costs money in both directions — call an ambiguous failure "rejected"
// and a retry puts a SECOND legal envelope in front of the client; call a
// definite failure "unknown" and the offer keeps a *_SENT claim nobody can
// clear.

const withStatus = (status: number) => ({
  response: { status },
  message: `Request failed with status code ${status}`,
});

test("a 4xx is a refusal we can trust", () => {
  // DocuSign understood the request and declined it. Nothing was created.
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(
      isDocusignTransportFailure(withStatus(status)),
      false,
      `${status} should be a definite rejection`,
    );
  }
});

test("a 5xx leaves the outcome open", () => {
  // The request reached DocuSign and may have been acted on before it failed.
  // Treating this as a rejection releases the claim and lets a retry create a
  // second envelope for the same offer.
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      isDocusignTransportFailure(withStatus(status)),
      true,
      `${status} must not be read as a definite rejection`,
    );
  }
});

test("a timeout with no response at all is unknown", () => {
  assert.equal(isDocusignTransportFailure({ code: "ECONNABORTED" }), true);
  assert.equal(isDocusignTransportFailure({ code: "ETIMEDOUT" }), true);
  assert.equal(isDocusignTransportFailure(new Error("socket hang up")), true);
});

test("an ordinary programming error is not mistaken for a transport failure", () => {
  assert.equal(
    isDocusignTransportFailure(new TypeError("x is not a function")),
    false,
  );
});

test("a failure before the context exists is a rejection, not an unknown", async () => {
  // createDocusignContext threw, so no create request was ever made and
  // nothing can be out for signature. Calling it unknown kept the *_SENT claim
  // and left the offer stuck with no envelope to find and no way to retry.
  const recovery = await resolveEnvelopeCreateError({
    error: { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
    context: null,
    sendAttemptId: "offer-1.attempt-1",
    attemptStarted: new Date(),
  });
  assert.equal(recovery.kind, "rejected");
});

test("a definite rejection never reaches reconciliation", async () => {
  const recovery = await resolveEnvelopeCreateError({
    error: withStatus(400),
    context: null,
    sendAttemptId: "offer-1.attempt-1",
    attemptStarted: new Date(),
  });
  assert.equal(recovery.kind, "rejected");
  assert.match(recovery.reason, /400/);
});
