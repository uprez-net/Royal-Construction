import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserByClerkId } from "@/lib/data/user";
import {
  OfferSupersededError,
  authorizeOffer,
} from "@/lib/domain/access/offers";
import { authorizeLead } from "@/lib/domain/access/leads";
import { isDomainError } from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";

// Shared authorization for the offer server actions. Every offer action is
// client-callable, so an offerId/leadId in the argument is NOT authorization —
// the caller must be authenticated AND permitted to access the lead behind the
// offer, or a user could act on someone else's offer (IDOR).
//
// The rule itself is lib/domain/access/offers.ts, which Eve calls too. What is
// left here is the Next half: resolving Clerk identity, and returning a
// `{ ok }` result rather than throwing, because a Server Action's rejection
// has to serialize back to the client.

export type OfferAccess =
  | { ok: true; user: User; leadId: number; isActive: boolean }
  | { ok: false; error: string };

// `allowInactive` opts a caller into superseded revisions. Only read paths may
// set it: every write must land on the lead's one live revision, or an edit
// would rewrite history.
export async function authorizeOfferAccess(
  offerId: string,
  options?: { allowInactive?: boolean },
): Promise<OfferAccess> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated || !clerkId) {
    return { ok: false, error: "Unauthorized" };
  }
  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return { ok: false, error: "No internal user for the signed-in account." };
  }

  try {
    const access = await authorizeOffer(userPrincipal(user), offerId, prisma, {
      allowInactive: options?.allowInactive,
    });
    return {
      ok: true,
      user,
      leadId: access.leadId,
      isActive: access.isActive,
    };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // Mapped rather than passed through, so the exact strings these actions
    // have always returned stay byte-identical for the screens that show them.
    if (error.code === "domain_not_found") {
      return { ok: false, error: "Offer not found." };
    }
    if (error instanceof OfferSupersededError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "You do not have access to this offer." };
  }
}

export type LeadAccess =
  | { ok: true; user: User }
  | { ok: false; error: string };

export async function authorizeLeadAccess(leadId: number): Promise<LeadAccess> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated || !clerkId) {
    return { ok: false, error: "Unauthorized" };
  }
  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return { ok: false, error: "No internal user for the signed-in account." };
  }
  try {
    await authorizeLead(userPrincipal(user), leadId, prisma);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { ok: false, error: "You do not have access to this lead." };
  }
  return { ok: true, user };
}
