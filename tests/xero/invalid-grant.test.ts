import assert from "node:assert/strict";
import { test } from "node:test";

import { isInvalidGrant } from "../../lib/xero/token-errors";

/**
 * This predicate decides whether a failed refresh deactivates the connection.
 * A false positive locks the organisation out until someone re-consents by
 * hand, so the cases below are the ones that must NOT be mistaken for a
 * rejected token.
 */
const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

test("recognises a rejected refresh token", () => {
  assert.equal(
    isInvalidGrant(axiosError(400, { error: "invalid_grant" })),
    true,
  );
});

// Some gateways hand back the body as text rather than parsed JSON.
test("recognises invalid_grant in an unparsed body", () => {
  assert.equal(
    isInvalidGrant(axiosError(400, '{"error":"invalid_grant"}')),
    true,
  );
});

test("a rate limit is not a rejected token", () => {
  assert.equal(
    isInvalidGrant(axiosError(429, { error: "rate_limit_exceeded" })),
    false,
  );
});

test("a Xero outage is not a rejected token", () => {
  assert.equal(isInvalidGrant(axiosError(503, "Service Unavailable")), false);
});

test("bad client credentials are not a rejected token", () => {
  // invalid_client means the app's secret is wrong — a config problem to fix,
  // not a connection to tear down.
  assert.equal(
    isInvalidGrant(axiosError(401, { error: "invalid_client" })),
    false,
  );
});

test("a network failure with no response is not a rejected token", () => {
  assert.equal(isInvalidGrant(new Error("ECONNRESET")), false);
  assert.equal(isInvalidGrant(undefined), false);
  assert.equal(isInvalidGrant(null), false);
});
