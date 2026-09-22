/**
 * The staging evaluator bootstrap.
 *
 * `eve eval --url` authenticates with a bearer token in
 * `EVE_EVAL_AUTH_TOKEN`, and `agent/lib/channel-auth.ts` will only accept a
 * Clerk session token. The development sign-in route cannot supply one: it
 * mints a one-time ticket that a browser exchanges for a cookie, and it is
 * hard-wired to `NODE_ENV=development` anyway, which a deployed Vercel Preview
 * is not.
 *
 * So the bootstrap is its own narrow thing: a POST that proves possession of a
 * shared secret and returns a short-lived Clerk session token for one
 * dedicated eval user. It is gated on the deployment environment rather than
 * on `NODE_ENV`, because Preview runs with production Node semantics and
 * `NODE_ENV` would not tell the two apart.
 */

export const EVAL_AUTH_HEADER = "x-eval-auth-secret";
export const EVAL_SESSION_HEADER = "x-eval-session-id";
/** Short enough that a leaked token is stale before it is useful. */
export const EVAL_TOKEN_TTL_SECONDS = 5 * 60;
export const EVAL_AUTH_WINDOW_MS = 60 * 1000;
export const EVAL_AUTH_REQUEST_LIMIT = 5;

type Environment = Record<string, string | undefined>;

export type StagingEvalConfig = {
  readonly enabled: boolean;
  readonly secret: string | undefined;
  readonly userId: string | undefined;
  readonly deployment: string | undefined;
  readonly databaseLabel: string | undefined;
  readonly fixtureVersion: string;
  /** `EVE_OPERATIONS_AGENT_ENABLED` on the target, reported to the wrapper. */
  readonly operationsAgentEnabled: boolean;
  /** `EVE_OPERATIONS_SPECIALISTS_ENABLED` on the target. */
  readonly specialistsEnabled: boolean;
};

export function stagingEvalConfig(
  env: Environment = process.env,
): StagingEvalConfig {
  const secret = env.EVE_EVAL_AUTH_SECRET?.trim() || undefined;
  const userId = env.EVE_EVAL_USER_ID?.trim() || undefined;

  return {
    databaseLabel: env.EVE_EVAL_DATABASE_LABEL?.trim() || undefined,
    deployment: env.VERCEL_URL?.trim() || undefined,
    // Three independent conditions, all required. `VERCEL_ENV === "preview"`
    // is the one that cannot be satisfied on production however the other two
    // are configured, which is what makes "production has no enabled
    // evaluator bootstrap" a property of the deployment rather than of
    // somebody remembering to unset a variable.
    enabled:
      env.EVE_EVAL_AUTH_ENABLED === "true"
      && env.VERCEL_ENV === "preview"
      && Boolean(secret && userId),
    fixtureVersion: env.EVE_EVAL_FIXTURE_VERSION?.trim() || "v1",
    operationsAgentEnabled: env.EVE_OPERATIONS_AGENT_ENABLED === "true",
    secret,
    specialistsEnabled: env.EVE_OPERATIONS_SPECIALISTS_ENABLED === "true",
    userId,
  };
}

// The secret compare, the address helper and the limiter are shared with the
// WhatsApp webhook and live in lib/http. Re-exported so the eval routes and
// their tests keep one import.
export { constantTimeSecretMatches } from "@/lib/http/secret-compare";
export {
  createFixedWindowRateLimiter,
  requestAddress,
} from "@/lib/http/rate-limit";

/**
 * Read only the Clerk session id claim, for revocation.
 *
 * This is not verification and must never be treated as any: the revoke route
 * authorises on the shared secret and then re-reads the session from Clerk to
 * confirm it belongs to the configured eval user before revoking it. All this
 * does is save the wrapper from having to carry the session id separately.
 */
export function sessionIdFromJwt(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sid?: unknown };
    return typeof decoded.sid === "string" && decoded.sid.length > 0
      ? decoded.sid
      : null;
  } catch {
    return null;
  }
}
