/**
 * Who holds an idempotency key, and for how long.
 *
 * Separated from the React hook that wraps it because this is the part with a
 * rule in it — when a key is reused and when it is replaced — and a rule that
 * decides whether a consultant is emailed once or twice should be reachable
 * from a test. The hook in hooks/use-idempotency-key.ts is the useRef around
 * it and nothing else.
 *
 * The rule: a key belongs to an attempt at an intent, not to a click. It is
 * minted on first use, returned unchanged for every later call, and only
 * dropped once the caller reports that the attempt succeeded. That is what
 * makes a double click, and a retry after a timeout, carry the same key, while
 * a send the office deliberately makes later carries a new one.
 */

/** Injectable so a test does not depend on a real UUID source. */
export type KeyFactory = () => string;

const defaultFactory: KeyFactory = () => crypto.randomUUID();

export type AttemptKeys = {
  /** The key for the attempt in progress against `target`, minted on demand. */
  current(target: string): string;
  /** Drop it, so the next attempt against `target` is a new intent. */
  rotate(target: string): void;
};

/** A holder keyed by target, for a caller that serves many at once. */
export function createAttemptKeys(
  mint: KeyFactory = defaultFactory,
): AttemptKeys {
  const keys = new Map<string, string>();
  return {
    current(target) {
      const existing = keys.get(target);
      if (existing !== undefined) return existing;
      const minted = mint();
      keys.set(target, minted);
      return minted;
    },
    rotate(target) {
      keys.delete(target);
    },
  };
}

/** The single-target case: one modal, one alert row, one form. */
export function createAttemptKey(mint: KeyFactory = defaultFactory) {
  const keys = createAttemptKeys(mint);
  const only = "";
  return {
    current: () => keys.current(only),
    rotate: () => keys.rotate(only),
  };
}

/**
 * The header, or nothing.
 *
 * Omitting it is valid: the domain derives a key instead. A blank or
 * whitespace-only value is not sent, because an empty header would be trimmed
 * to an empty string server side and fall back anyway, and sending it would
 * only suggest the caller had supplied something.
 */
export function idempotencyHeader(key?: string | null): Record<string, string> {
  const trimmed = key?.trim();
  return trimmed ? { "Idempotency-Key": trimmed } : {};
}
