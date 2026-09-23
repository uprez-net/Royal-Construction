// A per-instance request brake for routes on the open internet.
//
// Shared by the staging eval bootstrap (issue #335) and the WhatsApp webhook
// (issue #333). Node-safe and framework-free, so a route, a test and a script
// can all reach it.

/**
 * The caller's address, as the platform reports it.
 *
 * Vercel sets `x-forwarded-for`; the first hop is the client. Only ever a key
 * for a rate limit — never an identity or an access decision.
 */
export function requestAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * A fixed-window limiter held in module scope.
 *
 * Per-instance, so it is a brake rather than a quota: a serverless deployment
 * can hold several instances and a determined caller gets a multiple of the
 * limit. That is the right trade for the routes that use it — a secret or a
 * signature is the access control, and this exists so a misconfigured loop or
 * a scripted guess costs something. A shared counter would mean a Redis round
 * trip on routes that have to work when everything else is being debugged.
 */
export function createFixedWindowRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}) {
  const buckets = new Map<string, { count: number; startedAt: number }>();
  const now = options.now ?? Date.now;

  return {
    allow(key: string): boolean {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || current - bucket.startedAt >= options.windowMs) {
        buckets.set(key, { count: 1, startedAt: current });
        return true;
      }
      if (bucket.count >= options.limit) return false;
      bucket.count += 1;
      return true;
    },
    clear(): void {
      buckets.clear();
    },
  };
}
