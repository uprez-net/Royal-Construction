// A per-process brake on repeats of the same error.
//
// The free Sentry plan holds a few thousand events a month, and one bug in a
// retry loop or a polled screen can write that many in an afternoon — after
// which the real outage arrives to a quota that is already spent. Sentry groups
// repeats into one issue (and one email), but each repeat still counts against
// the quota, so the brake has to sit here, before the event is sent.

export interface Throttle {
  /** True when this key is still under its limit for the current window. */
  allow(key: string): boolean;
}

export function createThrottle(options: {
  /** Events allowed per key per window. */
  max: number;
  windowMs: number;
  /** Injected so a test controls the clock. */
  now?: () => number;
}): Throttle {
  const now = options.now ?? Date.now;
  const seen = new Map<string, { startedAt: number; count: number }>();

  return {
    allow(key) {
      const at = now();
      const entry = seen.get(key);
      if (!entry || at - entry.startedAt >= options.windowMs) {
        seen.set(key, { startedAt: at, count: 1 });
        // Keep the map from growing without bound on a long-lived instance.
        if (seen.size > 500) {
          for (const [candidate, value] of seen) {
            if (at - value.startedAt >= options.windowMs)
              seen.delete(candidate);
          }
        }
        return true;
      }
      entry.count += 1;
      return entry.count <= options.max;
    },
  };
}
