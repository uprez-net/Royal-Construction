import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import {
  createRefreshingFetch,
  installEvaluatorTokenRefresh,
  REFRESH_MARGIN_MS,
  REFRESH_RETRY_MS,
} from "@/lib/eval/evaluator-token";
import { EVAL_SESSION_HEADER } from "@/lib/eval/staging-auth";

/**
 * `eve eval` sends one bearer for a whole run and the deployment mints it for
 * five minutes, so a suite that ran 5m 11s went 401 for its last cases (run
 * 43504208093). These pin the refresh that keeps it current without touching
 * the requests that must not carry it.
 */

const target = new URL("https://royal-stage.vercel.app");
const T0 = 1_800_000_000_000;

function jwt(claims: { sid: string; exp: number }): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

const initial = jwt({ sid: "sess_1", exp: (T0 + 5 * 60_000) / 1000 });
const fresh = jwt({ sid: "sess_2", exp: (T0 + 10 * 60_000) / 1000 });
const bootstrap = (token: string, extra: Record<string, unknown> = {}) =>
  Response.json({
    environment: "preview",
    expiresInSeconds: 300,
    token,
    ...extra,
  });

function harness(mint: () => Response | Promise<Response>) {
  let clock = T0;
  const sent: { url: string; authorization: string | null }[] = [];
  const baseFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${target.origin}/api/eval/auth`) return mint();
    sent.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response(null, { status: 204 });
  });
  const refreshing = createRefreshingFetch({
    baseFetch,
    initialToken: initial,
    now: () => clock,
    secret: "test-secret",
    target,
  });
  return {
    baseFetch,
    refreshing,
    sent,
    mints: () =>
      baseFetch.mock.calls.filter(([u]) => String(u).endsWith("/api/eval/auth"))
        .length,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const asEve = { headers: { authorization: `Bearer ${initial}` } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRefreshingFetch", () => {
  it("sends the original token unchanged while it has time left", async () => {
    const h = harness(() => bootstrap(fresh));
    await h.refreshing.fetch(`${target.origin}/eve/v1/info`, asEve);
    assert.equal(h.mints(), 0);
    assert.equal(h.sent[0].authorization, `Bearer ${initial}`);
  });

  it("mints once near expiry and sends the new token from then on", async () => {
    const h = harness(() => bootstrap(fresh));
    h.advance(5 * 60_000 - REFRESH_MARGIN_MS + 1);
    // Two requests at once share one mint.
    await Promise.all([
      h.refreshing.fetch(`${target.origin}/eve/v1/session`, asEve),
      h.refreshing.fetch(new URL("/eve/v1/info", target), asEve),
    ]);
    await h.refreshing.fetch(`${target.origin}/eve/v1/session/x`, asEve);
    assert.equal(h.mints(), 1);
    assert.deepEqual(
      h.sent.map((s) => s.authorization),
      [`Bearer ${fresh}`, `Bearer ${fresh}`, `Bearer ${fresh}`],
    );
    assert.deepEqual(h.refreshing.refreshedTokens(), [fresh]);
  });

  it("gives up on a mint that never answers instead of hanging every request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = harness(
      () =>
        new Promise<Response>((_, reject) =>
          // What fetch does when the mint's timeout signal fires.
          queueMicrotask(() =>
            reject(new DOMException("timed out", "TimeoutError")),
          ),
        ),
    );
    h.advance(5 * 60_000 - REFRESH_MARGIN_MS + 1);
    await h.refreshing.fetch(`${target.origin}/eve/v1/info`, asEve);
    const mintInit = h.baseFetch.mock.calls.find(([u]) =>
      String(u).endsWith("/api/eval/auth"),
    )?.[1];
    assert.ok(mintInit?.signal instanceof AbortSignal);
    assert.equal(h.sent[0].authorization, `Bearer ${initial}`);
  });

  it("leaves every other request alone, however late in the run", async () => {
    const h = harness(() => bootstrap(fresh));
    h.advance(10 * 60_000);
    // The judge's model call, a case that sends no token, and a case that
    // sends a deliberately wrong one.
    await h.refreshing.fetch("https://ai-gateway.vercel.sh/v1/x", asEve);
    await h.refreshing.fetch(`${target.origin}/eve/v1/session`, {
      method: "POST",
    });
    await h.refreshing.fetch(`${target.origin}/eve/v1/session`, {
      headers: { Authorization: "Bearer not-a-token" },
    });
    assert.equal(h.mints(), 0);
    assert.deepEqual(
      h.sent.map((s) => s.authorization),
      [`Bearer ${initial}`, null, "Bearer not-a-token"],
    );
  });

  it("reads the bearer from a Request object too", async () => {
    const h = harness(() => bootstrap(fresh));
    h.advance(5 * 60_000);
    await h.refreshing.fetch(
      new Request(`${target.origin}/eve/v1/info`, asEve),
    );
    assert.equal(h.sent[0].authorization, `Bearer ${fresh}`);
  });

  for (const [label, mint] of [
    ["a failed mint", () => new Response(null, { status: 503 })],
    [
      "a token that is not short-lived",
      () => bootstrap(fresh, { expiresInSeconds: 301 }),
    ],
  ] as const) {
    it(`keeps the current token after ${label}, and waits before retrying`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const h = harness(mint);
      h.advance(5 * 60_000 - REFRESH_MARGIN_MS + 1);
      await h.refreshing.fetch(`${target.origin}/eve/v1/info`, asEve);
      await h.refreshing.fetch(`${target.origin}/eve/v1/info`, asEve);
      assert.equal(h.mints(), 1);
      h.advance(REFRESH_RETRY_MS);
      await h.refreshing.fetch(`${target.origin}/eve/v1/info`, asEve);
      assert.equal(h.mints(), 2);
      assert.ok(h.sent.every((s) => s.authorization === `Bearer ${initial}`));
      assert.deepEqual(h.refreshing.refreshedTokens(), []);
    });
  }
});

describe("installEvaluatorTokenRefresh", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does nothing for a local run with no evaluator token", () => {
    assert.equal(installEvaluatorTokenRefresh({}), undefined);
    assert.equal(globalThis.fetch, originalFetch);
  });

  it("patches fetch, then restores it and revokes each refreshed session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers({ now: T0 + 5 * 60_000 });
    try {
      const base = vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith("/api/eval/auth")
          ? bootstrap(fresh)
          : new Response(null, { status: 204 }),
      );
      globalThis.fetch = base;
      const installed = installEvaluatorTokenRefresh({
        EVE_EVAL_AUTH_SECRET: "test-secret",
        EVE_EVAL_AUTH_TOKEN: initial,
        EVE_EVAL_TARGET_ORIGIN: target.origin,
      });
      assert.ok(installed);
      assert.notEqual(globalThis.fetch, base);

      await globalThis.fetch(`${target.origin}/eve/v1/info`, asEve);
      await installed.revokeRefreshed();

      assert.equal(globalThis.fetch, base);
      const revokes = base.mock.calls.filter(([u]) =>
        String(u).endsWith("/api/eval/auth/revoke"),
      );
      assert.equal(revokes.length, 1);
      assert.equal(
        new Headers(revokes[0][1]?.headers).get(EVAL_SESSION_HEADER),
        "sess_2",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
