/**
 * Retry policy for Graph calls made off the response path.
 *
 * Before the webhook moved its work into `after()`, a retry cost the caller a
 * held-open response and risked Graph's 3-second acknowledgement window. Now
 * that the 202 is already written, waiting a few seconds for Graph to stop
 * throttling us is free — and the alternative is dropping a lead over a 429.
 */

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1500;

// Graph throttles hard under a burst of notifications and answers 429 with a
// Retry-After. Anything at or over 500 is Graph having a bad moment, and 408 is
// its gateway giving up on a slow upstream — all worth another go. A 401, 403,
// 404 or 413 is an answer, not a hiccup, and repeating it just burns time.
const RETRYABLE_STATUSES = new Set([408, 429]);

export function isRetryableGraphError(error: unknown): boolean {
  const status = statusOf(error);

  // No status at all means the request never got an answer — a socket reset, a
  // DNS blip, a timeout. Those are the retries that pay off most.
  if (status === undefined) {
    return true;
  }

  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

function retryAfterMsOf(error: unknown): number | undefined {
  const retryAfterMs = (error as { retryAfterMs?: unknown })?.retryAfterMs;
  return typeof retryAfterMs === 'number' ? retryAfterMs : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GraphRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /**
   * Overrides which failures are worth repeating. Defaults to
   * `isRetryableGraphError`.
   */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Runs a Graph call, repeating it while the failure looks transient.
 *
 * Rethrows the last error once the attempts are spent, so the caller still
 * decides what a permanent failure means — skipping one attachment is not the
 * same as skipping the message.
 */
export async function withGraphRetry<T>(
  label: string,
  task: () => Promise<T>,
  options: GraphRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableGraphError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt === attempts || !shouldRetry(error)) {
        console.warn(`[${label}] failed on attempt ${attempt}/${attempts}: ${message}`);
        throw error;
      }

      // Graph's own Retry-After wins over our backoff: guessing shorter than it
      // asked for is how a throttle turns into a longer throttle.
      const backoffMs = baseDelayMs * 2 ** (attempt - 1);
      const delayMs = Math.max(retryAfterMsOf(error) ?? 0, backoffMs);

      console.warn(
        `[${label}] attempt ${attempt}/${attempts} failed (${message}); retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}
