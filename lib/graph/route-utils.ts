import { timingSafeEqual } from "node:crypto";

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

// Constant-time compare so a wrong token cannot be recovered by timing the
// response. Lengths are checked first because timingSafeEqual throws on a
// length mismatch, and the length of a rejected guess is not worth protecting.
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Guards an admin-only Graph route.
 *
 * Fails CLOSED: an unset or empty `adminToken` rejects every request. This
 * previously returned null (allow) in that case, so any environment missing
 * GRAPH_ADMIN_TOKEN silently exposed every route relying on this guard.
 *
 * Accepts either `x-graph-admin-token: <token>` or
 * `authorization: Bearer <token>` — both shapes existed across these routes
 * before they shared one implementation, so both stay valid.
 *
 * Returns a Response to send when the request is rejected, or null to proceed.
 */
export function requireAdminToken(
  request: Request,
  adminToken: string | undefined,
): Response | null {
  if (!adminToken) {
    console.error(
      "GRAPH_ADMIN_TOKEN is not configured; refusing the request. Set it to enable this route.",
    );
    return unauthorized();
  }

  const authHeader = request.headers.get("authorization");
  const provided =
    request.headers.get("x-graph-admin-token") ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  // Never log the provided or expected token: these are public-facing routes
  // and the logs are not a secret store.
  if (!provided || !tokensMatch(provided, adminToken)) {
    console.warn("Rejected an unauthorized Graph admin request");
    return unauthorized();
  }

  return null;
}

export function jsonError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}
