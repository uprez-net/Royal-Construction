import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { summariseXeroFailure } from "@/lib/xero/failure";

// What `xero-node` really rejects with: not an Error but
// JSON.stringify(new ApiError(axiosError).generateError()), a string holding the
// response body (the values that were submitted) and the request, whose headers
// carry the access token.
function xeroRejection(statusCode: number, body: unknown): string {
  return JSON.stringify({
    response: {
      statusCode,
      body,
      headers: { "x-correlation-id": "abc" },
      request: {
        url: { host: "api.xero.com", path: "/api.xro/2.0/Invoices" },
        headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.SECRET-TOKEN" },
        method: "POST",
      },
    },
    body,
  });
}

const VALIDATION = {
  Type: "ValidationException",
  Message: "A validation exception occurred",
  Elements: [
    {
      Contact: { Name: "Jane Citizen", EmailAddress: "jane@example.com" },
      LineItems: [
        { Description: "Stage 2 claim for 14 Wattle St", UnitAmount: 48250 },
      ],
      ValidationErrors: [{ Message: "Account code '200' is not a valid code" }],
    },
  ],
};

describe("summariseXeroFailure — only the status and the error type leave", () => {
  test("a validation failure keeps its status and Xero's error type", () => {
    const summary = summariseXeroFailure(
      xeroRejection(400, VALIDATION),
      "createInvoices",
    ) as Error & { status?: number };
    assert.equal(
      summary.message,
      "Xero createInvoices failed: HTTP 400 (ValidationException)",
    );
    assert.equal(summary.name, "XeroApiError");
    assert.equal(summary.status, 400);
  });

  test("nothing that was submitted, and no token, is in what is reported", () => {
    const summary = summariseXeroFailure(
      xeroRejection(400, VALIDATION),
      "createInvoices",
    ) as Error;
    const everything = JSON.stringify([
      summary.message,
      summary.name,
      summary.stack,
    ]);
    for (const leaked of [
      "Jane Citizen",
      "jane@example.com",
      "Wattle St",
      "48250",
      "SECRET-TOKEN",
      "Bearer",
      "authorization",
    ]) {
      assert.ok(!everything.includes(leaked), `leaked: ${leaked}`);
    }
  });

  test("the status is carried so the 4xx rule still applies", () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const summary = summariseXeroFailure(
        xeroRejection(status, { Type: "SomeException" }),
        "getInvoice",
      ) as Error & { status?: number };
      assert.equal(summary.status, status);
    }
  });

  test("a rejection that is an object, not a string, is handled the same way", () => {
    const summary = summariseXeroFailure(
      { response: { statusCode: 503, body: VALIDATION } },
      "getContacts",
    ) as Error & { status?: number };
    assert.equal(summary.status, 503);
    assert.ok(!summary.message.includes("Jane"));
  });

  test("an error type that could hold content is not trusted", () => {
    const summary = summariseXeroFailure(
      xeroRejection(400, { Type: "Contact Jane Citizen is invalid" }),
      "createContacts",
    ) as Error;
    assert.equal(summary.message, "Xero createContacts failed: HTTP 400");
  });

  test("a rejection that cannot be parsed yields a generic failure, never its content", () => {
    const summary = summariseXeroFailure(
      "<html>Jane Citizen at jane@example.com</html>",
      "getInvoice",
    ) as Error & { status?: number };
    assert.equal(summary.message, "Xero getInvoice failed");
    assert.equal(summary.status, undefined);
  });

  test("a real Error (a dropped connection, a timeout) has no body and passes through", () => {
    const timeout = new Error("Xero token refresh timed out");
    assert.equal(summariseXeroFailure(timeout, "refreshToken"), timeout);
  });

  test("never throws, whatever it is given", () => {
    for (const value of [undefined, null, 0, "", {}, [], Symbol("x")]) {
      assert.doesNotThrow(() => summariseXeroFailure(value, "op"));
    }
  });
});
