import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import { browserIdentity } from "../../ports/comms";
import {
  INTERNAL_ROLES,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../../principal";

// Which staff browsers an inbound call rings.
//
// Nobody marks themselves "available": a browser that asked for a calling
// credential recently is one that can ring. Credentials live ten minutes and
// the dialer refreshes them while the app is open, so "seen in the last
// fifteen minutes" is "has the app open now", give or take one refresh.

export const BROWSER_PRESENCE_WINDOW_MS = 15 * 60 * 1000;

/** Record that this user's browser can take calls. Returns their identity. */
export async function recordBrowserPresence(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
): Promise<string> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Browser calling is for signed-in members of staff.",
    );
  }
  await db.user.update({
    data: { commsBrowserSeenAt: now },
    where: { id: principal.userId },
  });
  return browserIdentity(principal.userId);
}

/** Identities to ring, most recently seen first. */
export async function browserRingIdentities(
  db: DomainDb,
  now: Date = new Date(),
): Promise<string[]> {
  const users = await db.user.findMany({
    orderBy: { commsBrowserSeenAt: "desc" },
    select: { id: true },
    take: 10,
    where: {
      commsBrowserSeenAt: { gte: new Date(now.getTime() - BROWSER_PRESENCE_WINDOW_MS) },
      role: { in: [...INTERNAL_ROLES] },
    },
  });
  return users.map((user) => browserIdentity(user.id));
}
