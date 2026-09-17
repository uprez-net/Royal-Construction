const SESSION_OWNER_RETRY_DELAYS_MS = [
  40, 100, 200, 400, 800, 1_200,
] as const;

type SessionOwnerLookup = (eveSessionId: string) => Promise<string | null>;

/**
 * Eve returns a newly-created session before stream hooks finish writing the
 * application ownership row. Wait only for an as-yet-unregistered session;
 * once a row exists, a foreign owner is rejected immediately.
 */
export async function waitForOwnedAgentSession(
  lookup: SessionOwnerLookup,
  eveSessionId: string,
  expectedOwnerUserId: string,
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
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return false;
}
