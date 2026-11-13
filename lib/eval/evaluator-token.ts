import {
  EVAL_AUTH_HEADER,
  EVAL_SESSION_HEADER,
  EVAL_TOKEN_TTL_SECONDS,
  sessionIdFromJwt,
} from "@/lib/eval/staging-auth";

/**
 * The evaluator's side of the staging bootstrap: mint, refresh and revoke the
 * short-lived Clerk session token that `eve eval --url` sends as its bearer.
 *
 * Minting and revoking are shared by the wrapper (`scripts/eve-eval-staging.ts`)
 * and the eval config's setup/teardown (`evals/evals.config.ts`), so there is
 * one copy of each.
 */

export type BootstrapResponse = {
  readonly token?: unknown;
  readonly expiresInSeconds?: unknown;
  readonly environment?: unknown;
  readonly deployment?: unknown;
  readonly databaseLabel?: unknown;
  readonly fixtureVersion?: unknown;
  readonly operationsAgentEnabled?: unknown;
  readonly specialistsEnabled?: unknown;
};

/** Refresh once less than this is left on the token. Covers one request; a
 * stream is authenticated when it opens, not for its whole life. */
export const REFRESH_MARGIN_MS = 2 * 60 * 1000;
/** After a failed refresh, wait this long before asking again, so a broken
 * bootstrap is not hammered into its rate limit on every request. */
export const REFRESH_RETRY_MS = 30 * 1000;
/** A mint that has not answered by now is a failed refresh, not a hang:
 * every request waiting on the shared refresh waits on this call. */
export const MINT_TIMEOUT_MS = 15 * 1000;

async function responseJson(response: Response): Promise<BootstrapResponse> {
  if (!response.ok) {
    const hint =
      response.status === 404
        ? " The bootstrap route is disabled on this deployment (EVE_EVAL_AUTH_ENABLED, VERCEL_ENV=preview, EVE_EVAL_USER_ID)."
        : response.status === 401
          ? " EVE_EVAL_AUTH_SECRET does not match the deployment's."
          : "";
    throw new Error(
      `Staging evaluator authentication returned HTTP ${response.status}.${hint}`,
    );
  }
  try {
    return (await response.json()) as BootstrapResponse;
  } catch {
    throw new Error("Staging evaluator authentication returned invalid JSON.");
  }
}

export async function mintEvaluatorToken(
  target: URL,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BootstrapResponse> {
  const response = await fetchImpl(new URL("/api/eval/auth", target), {
    cache: "no-store",
    headers: { [EVAL_AUTH_HEADER]: secret },
    method: "POST",
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  return responseJson(response);
}

/** The part of the bootstrap check every minted token must pass, the first
 * one and every refresh alike. */
export function assertShortLivedToken(
  body: BootstrapResponse,
): asserts body is BootstrapResponse & { token: string } {
  if (
    typeof body.token !== "string"
    || body.environment !== "preview"
    || typeof body.expiresInSeconds !== "number"
    || body.expiresInSeconds > EVAL_TOKEN_TTL_SECONDS
  ) {
    throw new Error(
      "The staging target did not return a short-lived evaluator token.",
    );
  }
}

export async function revokeEvaluatorToken(
  target: URL,
  secret: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const sessionId = sessionIdFromJwt(token);
  if (!sessionId) return;
  const response = await fetchImpl(new URL("/api/eval/auth/revoke", target), {
    cache: "no-store",
    headers: {
      [EVAL_AUTH_HEADER]: secret,
      [EVAL_SESSION_HEADER]: sessionId,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Staging evaluator session revocation failed.");
  }
}

/** Read the `exp` claim, in milliseconds. Not verification: the deployment
 * verifies; this only decides when to ask for a new one. */
export function tokenExpiresAtMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
}

/**
 * A `fetch` that keeps the evaluator's bearer fresh for a whole suite.
 *
 * `eve eval` reads `EVE_EVAL_AUTH_TOKEN` once and sends that exact string on
 * every request, but the deployment mints it for five minutes and a read-only
 * suite takes about that long (run 43504208093 went 401 at 5m 11s). This
 * swaps the original bearer for a current one on requests to the target, and
 * mints a new token when the current one is within REFRESH_MARGIN_MS of
 * expiry. The five-minute lifetime is unchanged.
 *
 * Only a request to the target origin carrying exactly the original bearer is
 * touched. Anything else — the judge's model calls, the bootstrap itself, and
 * the cases that deliberately send no token or a bad one — passes through.
 */
export function createRefreshingFetch(options: {
  readonly target: URL;
  readonly secret: string;
  readonly initialToken: string;
  readonly baseFetch: typeof fetch;
  readonly now?: () => number;
  readonly onRefresh?: (count: number) => void;
}): { fetch: typeof fetch; refreshedTokens: () => readonly string[] } {
  const { target, secret, initialToken, baseFetch } = options;
  const now = options.now ?? Date.now;
  const original = `Bearer ${initialToken}`;
  const refreshed: string[] = [];
  let current = initialToken;
  let expiresAt = tokenExpiresAtMs(initialToken);
  let retryAt = 0;
  let pending: Promise<void> | undefined;

  async function refresh(): Promise<void> {
    try {
      const body = await mintEvaluatorToken(target, secret, baseFetch);
      assertShortLivedToken(body);
      current = body.token;
      expiresAt = tokenExpiresAtMs(body.token);
      refreshed.push(body.token);
      options.onRefresh?.(refreshed.length);
    } catch (error) {
      retryAt = now() + REFRESH_RETRY_MS;
      console.error(
        `Could not refresh the evaluator token: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async function currentToken(): Promise<string> {
    if (expiresAt === null || expiresAt - now() > REFRESH_MARGIN_MS) {
      return current;
    }
    if (now() < retryAt) return current;
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    await pending;
    return current;
  }

  const refreshingFetch: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    if (!url || url.origin !== target.origin) return baseFetch(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.get("authorization") !== original) {
      return baseFetch(input, init);
    }
    headers.set("authorization", `Bearer ${await currentToken()}`);
    return baseFetch(input, { ...init, headers });
  };

  return { fetch: refreshingFetch, refreshedTokens: () => [...refreshed] };
}

/**
 * Install the refreshing fetch for this process when the staging wrapper
 * launched it, and return the cleanup that revokes every refreshed session.
 * The wrapper revokes the first one itself. Returns undefined for a local
 * `eve eval`, which sends no bearer at all.
 */
export function installEvaluatorTokenRefresh(
  env: Record<string, string | undefined> = process.env,
): { revokeRefreshed: () => Promise<void> } | undefined {
  const initialToken = env.EVE_EVAL_AUTH_TOKEN?.trim();
  const secret = env.EVE_EVAL_AUTH_SECRET?.trim();
  const origin = env.EVE_EVAL_TARGET_ORIGIN?.trim();
  if (!initialToken || !secret || !origin) return undefined;

  const target = new URL(origin);
  const baseFetch = globalThis.fetch;
  const refreshing = createRefreshingFetch({
    baseFetch,
    initialToken,
    onRefresh: (count) =>
      console.error(`Evaluator token refreshed (${count}).`),
    secret,
    target,
  });
  globalThis.fetch = refreshing.fetch;

  return {
    async revokeRefreshed() {
      globalThis.fetch = baseFetch;
      // One at a time: the revoke route shares the bootstrap's small rate
      // limit. A refusal is not fatal, the token expires on its own.
      for (const token of refreshing.refreshedTokens()) {
        await revokeEvaluatorToken(target, secret, token, baseFetch).catch(
          () => {
            console.error(
              "Could not revoke a refreshed evaluator session; its token will expire automatically.",
            );
          },
        );
      }
    },
  };
}
