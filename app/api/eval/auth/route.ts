import { createClerkClient } from "@clerk/backend";
import {
  constantTimeSecretMatches,
  createFixedWindowRateLimiter,
  EVAL_AUTH_HEADER,
  EVAL_AUTH_REQUEST_LIMIT,
  EVAL_AUTH_WINDOW_MS,
  EVAL_TOKEN_TTL_SECONDS,
  requestAddress,
  stagingEvalConfig,
} from "@/lib/eval/staging-auth";

/**
 * POST /api/eval/auth — mint a short-lived evaluator session token.
 *
 * Only POST is exported, so any other method is a 405 from the router rather
 * than a code path here. `proxy.ts` lets this route past Clerk's middleware
 * before session protection runs, because the caller authenticates with a
 * shared secret and needs the structured 401/404 below rather than a redirect
 * to a sign-in page.
 *
 * Everything about the response is deliberately thin: the wrapper needs a
 * token and enough environment facts to refuse a target it did not mean to
 * run against. Nothing else is worth handing to whoever is holding the secret.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createFixedWindowRateLimiter({
  limit: EVAL_AUTH_REQUEST_LIMIT,
  windowMs: EVAL_AUTH_WINDOW_MS,
});

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = stagingEvalConfig();

  // 404, not 403: on production, and on any preview that has not opted in,
  // this route should be indistinguishable from one that does not exist.
  if (!config.enabled || !config.secret || !config.userId) {
    return json({ error: "Not found" }, 404);
  }

  if (!limiter.allow(requestAddress(request))) {
    return json({ error: "Too many requests" }, 429);
  }

  if (
    !constantTimeSecretMatches(
      request.headers.get(EVAL_AUTH_HEADER),
      config.secret,
    )
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const clerk = createClerkClient({
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    const session = await clerk.sessions.createSession({
      userId: config.userId,
    });
    const token = await clerk.sessions.getToken(
      session.id,
      undefined,
      EVAL_TOKEN_TTL_SECONDS,
    );

    return json(
      {
        databaseLabel: config.databaseLabel,
        deployment: config.deployment,
        environment: "preview",
        expiresInSeconds: EVAL_TOKEN_TTL_SECONDS,
        fixtureVersion: config.fixtureVersion,
        // The two fail-closed agent flags. The wrapper refuses to run a suite
        // against a deployment where the agent or its specialists are off:
        // every case would fail on `agent_disabled` or route into nothing, and
        // a wall of red that means "misconfigured" is worse than one error
        // that says so.
        operationsAgentEnabled: config.operationsAgentEnabled,
        specialistsEnabled: config.specialistsEnabled,
        token: token.jwt,
      },
      200,
    );
  } catch {
    // Do not return provider details: Clerk errors can carry identifiers or
    // request metadata, and the wrapper only needs a retryable status.
    return json({ error: "Evaluator authentication failed" }, 503);
  }
}
