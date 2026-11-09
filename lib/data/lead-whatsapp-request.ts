import "server-only";

import { currentPrincipal } from "@/lib/data/current-principal";
import type { UserPrincipal } from "@/lib/domain/principal";

// Request plumbing shared by the lead WhatsApp routes (issue #333). Nothing
// here decides anything: the lib/domain/leads/whatsapp commands own every
// rule and re-check the caller themselves.

/**
 * The signed-in user behind this request, or null.
 *
 * `currentPrincipal()` answers a *system* principal when there is no Clerk
 * session at all — right for the booking route and the crons, wrong here. A
 * system principal counts as internal staff, so passing it on would let an
 * unauthenticated request read a thread. These routes are screen adapters, so
 * anything that is not a user is refused before the domain is reached.
 */
export async function signedInUserPrincipal(): Promise<UserPrincipal | null> {
  const principal = await currentPrincipal();
  return principal.kind === "user" ? principal : null;
}

/** A positive integer route id, or null. */
export function parsePositiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
