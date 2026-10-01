/**
 * How long a stream request waits for a brand-new session's ownership row.
 *
 * The row is written by the event hook on the session's first event, and a
 * session parks before its hooks run until its first message has initialised
 * it. On a cold start that took longer than the ~2.7s this used to allow, so
 * the very first stream of a new conversation was refused with "The requested
 * agent session is unavailable" while the turn ran on regardless — the
 * operator was told the message was not sent, and resending it ran it twice.
 *
 * About fifteen seconds in total. Only a session with no row at all waits: a
 * row with a foreign owner is refused on the first read, so this never slows
 * down an access check that can already be answered.
 */
const SESSION_OWNER_RETRY_DELAYS_MS = [
  40, 100, 200, 400, 800, 1_200, 1_600, 2_000, 2_500, 3_000, 3_000,
] as const;

export const SESSION_OWNER_WAIT_BUDGET_MS =
  SESSION_OWNER_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0);

type SessionOwnerLookup = (eveSessionId: string) => Promise<string | null>;
type Sleep = (ms: number) => Promise<void>;

const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Eve returns a newly-created session before stream hooks finish writing the
 * application ownership row. Wait only for an as-yet-unregistered session;
 * once a row exists, a foreign owner is rejected immediately.
 */
export async function waitForOwnedAgentSession(
  lookup: SessionOwnerLookup,
  eveSessionId: string,
  expectedOwnerUserId: string,
  wait: Sleep = sleep,
): Promise<boolean> {
  for (
    let attempt = 0;
    attempt <= SESSION_OWNER_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const ownerUserId = await lookup(eveSessionId);
    if (ownerUserId !== null) return ownerUserId === expectedOwnerUserId;

    const delay = SESSION_OWNER_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      await wait(delay);
    }
  }

  return false;
}
