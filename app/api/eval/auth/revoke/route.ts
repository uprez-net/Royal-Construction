import { createClerkClient } from "@clerk/backend";
import {
  constantTimeSecretMatches,
  createFixedWindowRateLimiter,
  EVAL_AUTH_HEADER,
  EVAL_AUTH_REQUEST_LIMIT,
  EVAL_AUTH_WINDOW_MS,
  EVAL_SESSION_HEADER,
  requestAddress,
  stagingEvalConfig,
} from "@/lib/eval/staging-auth";

/**
 * POST /api/eval/auth/revoke — end an evaluator session early.
 *
 * The token already expires in five minutes, so this is belt and braces: the
 * wrapper calls it in a `finally` so a run that has finished does not leave a
 * live session behind for the rest of its TTL.
 *
 * The secret authorises the call, but it does not decide which session is
 * revoked. The session is re-read from Clerk and refused unless it belongs to
 * the configured eval user, so the route cannot be used as a
 * revoke-any-session primitive by whoever holds the secret.
 */

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
  const sessionId = request.headers.get(EVAL_SESSION_HEADER)?.trim();

  if (!config.enabled || !config.secret || !config.userId) {
    return json({ error: "Not found" }, 404);
  }
  if (!limiter.allow(requestAddress(request))) {
    return json({ error: "Too many requests" }, 429);
  }
  if (
    !sessionId
    || !constantTimeSecretMatches(
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
    const session = await clerk.sessions.getSession(sessionId);
    if (session.userId !== config.userId) {
      return json({ error: "Not found" }, 404);
    }
    await clerk.sessions.revokeSession(sessionId);
    return new Response(null, {
      headers: { "Cache-Control": "no-store" },
      status: 204,
    });
  } catch {
    return json({ error: "Evaluator session could not be revoked" }, 503);
  }
}
