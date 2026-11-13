import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  errorReportingEnabled,
  reportingEnvironment,
} from "@/lib/observability/environment";

const DSN = "https://key@o1.ingest.sentry.io/1";

describe("production only — never preview, never staging", () => {
  test("the production deployment reports", () => {
    const env = reportingEnvironment({ VERCEL_ENV: "production" });
    assert.equal(env, "production");
    assert.equal(errorReportingEnabled(env, DSN), true);
  });

  test("a preview deployment does not", () => {
    const env = reportingEnvironment({ VERCEL_ENV: "preview" });
    assert.equal(errorReportingEnabled(env, DSN), false);
  });

  test("local development does not, even with the DSN in .env", () => {
    const env = reportingEnvironment({});
    assert.equal(errorReportingEnabled(env, DSN), false);
  });

  test("staging does not, even though its Vercel project says production", () => {
    // The staging project's own domain reports VERCEL_ENV=production. Reading
    // VERCEL_ENV alone would mail staging's errors to the office inbox.
    const env = reportingEnvironment({
      APP_ENV: "staging",
      VERCEL_ENV: "production",
    });
    assert.equal(env, "staging");
    assert.equal(errorReportingEnabled(env, DSN), false);
  });

  test("production without a DSN sends nothing rather than failing", () => {
    assert.equal(errorReportingEnabled("production", undefined), false);
    assert.equal(errorReportingEnabled("production", ""), false);
    assert.equal(errorReportingEnabled("production", "   "), false);
  });

  test("the browser passes the inlined build-time value", () => {
    assert.equal(errorReportingEnabled("production", DSN), true);
    assert.equal(errorReportingEnabled(undefined, DSN), false);
  });
});
