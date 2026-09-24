import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  constantTimeSecretMatches,
  createFixedWindowRateLimiter,
  EVAL_AUTH_REQUEST_LIMIT,
  EVAL_AUTH_WINDOW_MS,
  sessionIdFromJwt,
  stagingEvalConfig,
} from "@/lib/eval/staging-auth";

/**
 * The acceptance table from issue #335, written down as tests.
 *
 * The route itself is a thin shell around `stagingEvalConfig` and
 * `constantTimeSecretMatches`; these are the two decisions that actually gate
 * it, so they are the two worth pinning. A regression here does not fail a
 * staging run — it opens a token-minting endpoint.
 */

const enabled = {
  EVE_EVAL_AUTH_ENABLED: "true",
  EVE_EVAL_AUTH_SECRET: "s3cret",
  EVE_EVAL_USER_ID: "user_eval",
  VERCEL_ENV: "preview",
} as const;

describe("stagingEvalConfig", () => {
  it("enables only on a preview deployment with a secret and a user", () => {
    assert.equal(stagingEvalConfig({ ...enabled }).enabled, true);
  });

  it("cannot be enabled on production", () => {
    assert.equal(
      stagingEvalConfig({ ...enabled, VERCEL_ENV: "production" }).enabled,
      false,
    );
  });

  it("cannot be enabled on a deployment with no VERCEL_ENV at all", () => {
    assert.equal(
      stagingEvalConfig({ ...enabled, VERCEL_ENV: undefined }).enabled,
      false,
    );
  });

  it("stays disabled when the flag is anything other than the exact string", () => {
    for (const value of ["TRUE", "1", "yes", "", " true "]) {
      assert.equal(
        stagingEvalConfig({ ...enabled, EVE_EVAL_AUTH_ENABLED: value }).enabled,
        false,
        `EVE_EVAL_AUTH_ENABLED=${JSON.stringify(value)} must not enable the route`,
      );
    }
  });

  it("stays disabled without a secret or without a user id", () => {
    assert.equal(
      stagingEvalConfig({ ...enabled, EVE_EVAL_AUTH_SECRET: "  " }).enabled,
      false,
    );
    assert.equal(
      stagingEvalConfig({ ...enabled, EVE_EVAL_USER_ID: "" }).enabled,
      false,
    );
  });

  it("never falls back to the DEV_AUTH defaults", () => {
    const config = stagingEvalConfig({
      ...enabled,
      DEV_AUTH_CLERK_USER_ID: "user_dev_default",
      EVE_EVAL_USER_ID: "",
    });
    assert.equal(config.enabled, false);
    assert.equal(config.userId, undefined);
  });

  it("reports the two fail-closed agent flags to the wrapper", () => {
    const off = stagingEvalConfig({ ...enabled });
    assert.equal(off.operationsAgentEnabled, false);
    assert.equal(off.specialistsEnabled, false);

    const on = stagingEvalConfig({
      ...enabled,
      EVE_OPERATIONS_AGENT_ENABLED: "true",
      EVE_OPERATIONS_SPECIALISTS_ENABLED: "true",
    });
    assert.equal(on.operationsAgentEnabled, true);
    assert.equal(on.specialistsEnabled, true);
  });

  it("defaults the fixture version rather than leaving it undefined", () => {
    assert.equal(stagingEvalConfig({ ...enabled }).fixtureVersion, "v1");
    assert.equal(
      stagingEvalConfig({ ...enabled, EVE_EVAL_FIXTURE_VERSION: " v2 " })
        .fixtureVersion,
      "v2",
    );
  });
});

describe("constantTimeSecretMatches", () => {
  it("matches an identical secret", () => {
    assert.equal(constantTimeSecretMatches("s3cret", "s3cret"), true);
  });

  it("rejects a wrong secret, including one of a different length", () => {
    assert.equal(constantTimeSecretMatches("s3crey", "s3cret"), false);
    assert.equal(constantTimeSecretMatches("s3cret-and-more", "s3cret"), false);
    assert.equal(constantTimeSecretMatches("s3", "s3cret"), false);
  });

  it("rejects a missing secret on either side", () => {
    assert.equal(constantTimeSecretMatches(null, "s3cret"), false);
    assert.equal(constantTimeSecretMatches(undefined, "s3cret"), false);
    assert.equal(constantTimeSecretMatches("", "s3cret"), false);
    assert.equal(constantTimeSecretMatches("s3cret", undefined), false);
    // Both empty is still a refusal: an unconfigured deployment must not
    // accept a caller that also sends nothing.
    assert.equal(constantTimeSecretMatches("", ""), false);
  });
});

describe("createFixedWindowRateLimiter", () => {
  it("allows up to the limit and then refuses within the window", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({
      limit: EVAL_AUTH_REQUEST_LIMIT,
      now: () => now,
      windowMs: EVAL_AUTH_WINDOW_MS,
    });

    for (let attempt = 0; attempt < EVAL_AUTH_REQUEST_LIMIT; attempt += 1) {
      assert.equal(limiter.allow("1.2.3.4"), true, `attempt ${attempt}`);
    }
    assert.equal(limiter.allow("1.2.3.4"), false);

    // A different caller has its own bucket.
    assert.equal(limiter.allow("5.6.7.8"), true);

    // The window rolls over.
    now += EVAL_AUTH_WINDOW_MS;
    assert.equal(limiter.allow("1.2.3.4"), true);
  });
});

describe("sessionIdFromJwt", () => {
  function jwt(payload: unknown): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    return `header.${encoded}.signature`;
  }

  it("reads the sid claim", () => {
    assert.equal(sessionIdFromJwt(jwt({ sid: "sess_123" })), "sess_123");
  });

  it("returns null rather than throwing on anything unusable", () => {
    assert.equal(sessionIdFromJwt("not-a-jwt"), null);
    assert.equal(sessionIdFromJwt(""), null);
    assert.equal(sessionIdFromJwt("header..signature"), null);
    assert.equal(sessionIdFromJwt(jwt({})), null);
    assert.equal(sessionIdFromJwt(jwt({ sid: "" })), null);
    assert.equal(sessionIdFromJwt(jwt({ sid: 42 })), null);
    assert.equal(sessionIdFromJwt("header.bm90LWpzb24.signature"), null);
  });
});
