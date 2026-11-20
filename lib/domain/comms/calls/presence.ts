import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import { browserIdentity } from "../../ports/comms";
import { isOfficePrincipal, type DomainPrincipal } from "../../principal";

// A staff browser asking for a calling credential.
//
// The browser phone only ever takes the second leg of a call its own user
// placed: an inbound call is answered by Mili and never rings a browser
// (flow.ts). `commsBrowserSeenAt` is still stamped, so the office can see who
// had the phone open, but nothing routes on it.

/** Record that this user's browser can take calls. Returns their identity. */
export async function recordBrowserPresence(
  principal: DomainPrincipal,
  db: DomainDb,
  now: Date = new Date(),
): Promise<string> {
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
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
