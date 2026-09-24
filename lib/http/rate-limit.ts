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
 *
 * The routes are public and the key is a header the caller controls, so the
 * table is bounded: expired windows are dropped on every call, and at most
 * `maxBuckets` addresses are tracked at once. Past that the oldest window is
 * evicted, which forgets one address's count early — a brake that loosens
 * under a flood of addresses rather than an instance that runs out of memory.
 */
export const DEFAULT_MAX_RATE_LIMIT_BUCKETS = 10_000;

export function createFixedWindowRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  readonly maxBuckets?: number;
}) {
  // A window is only ever inserted with the current time, so the first entry
  // is the oldest one — the one evicted when the table is full.
  const buckets = new Map<string, { count: number; startedAt: number }>();
  const now = options.now ?? Date.now;
  const maxBuckets = Math.max(
    1,
    options.maxBuckets ?? DEFAULT_MAX_RATE_LIMIT_BUCKETS,
  );

  return {
    allow(key: string): boolean {
      const current = now();
      for (const [address, bucket] of buckets) {
        if (current - bucket.startedAt >= options.windowMs) {
          buckets.delete(address);
        }
      }
      const bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxBuckets) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
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
