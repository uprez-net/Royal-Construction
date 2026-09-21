import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";

// Who owns an Eve session.
//
// Checked in three places today with three different failure shapes:
// agent/lib/channel-auth.ts refuses the request, agent/lib/audited-operation.ts
// re-checks inside the transaction it audits (correctly — the channel check
// happened before the transaction opened), and the session pages check again
// to decide what to render. The rule itself is one line, which is exactly how
// it ends up written three times.

export type AgentSessionOwnership = {
  readonly agentSessionId: string;
  readonly ownerUserId: string;
};

/**
 * The owner of an Eve session, or null when the application has not
 * registered it yet.
 *
 * Null is not "no owner": Eve returns a newly-created session before the
 * stream hooks finish writing the ownership row, so an unregistered session is
 * a race to wait out, not a refusal. `waitForOwnedAgentSession` in
 * agent/lib/session-owner.ts is what does the waiting; it takes this as its
 * lookup.
 */
export async function findAgentSessionOwner(
  eveSessionId: string,
  db: DomainDb,
): Promise<AgentSessionOwnership | null> {
  const session = await db.agentSession.findUnique({
    select: { id: true, ownerUserId: true },
    where: { eveSessionId },
  });
  return session
    ? { agentSessionId: session.id, ownerUserId: session.ownerUserId }
    : null;
}

/**
 * Assert this user owns this Eve session, and return it.
 *
 * Refuses an unregistered session too: unlike the channel check, a caller here
 * already holds a session it believes exists, so "not written yet" and "not
 * yours" are both reasons not to act on it. Deliberately one message for both,
 * so a probe cannot use the difference to learn which sessions exist.
 */
export async function authorizeAgentSession(
  eveSessionId: string,
  ownerUserId: string,
  db: DomainDb,
): Promise<AgentSessionOwnership> {
  const session = await findAgentSessionOwner(eveSessionId, db);
  if (!session || session.ownerUserId !== ownerUserId) {
    throw new DomainAuthorizationError("The agent session is unavailable.");
  }
  return session;
}
