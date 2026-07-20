import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserByClerkId } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";

// Shared authorization for the offer server actions. Every offer action is
// client-callable, so an offerId/leadId in the argument is NOT authorization —
// the caller must be authenticated AND permitted to access the lead behind the
// offer, or a user could act on someone else's offer (IDOR).

export type OfferAccess =
  | { ok: true; user: User; leadId: number; isActive: boolean }
  | { ok: false; error: string };

// `allowInactive` opts a caller into superseded revisions. Only read paths may
// set it: every write must land on the lead's one live revision, or an edit
// would rewrite history (see the superseded-revision guard below).
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
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { leadId: true, isActive: true },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  try {
    await assertCanAccessLead(user, offer.leadId);
  } catch {
    return { ok: false, error: "You do not have access to this offer." };
  }
  // Superseded revisions are history: readable, never writable. This is keyed on
  // isActive rather than offerStatus === SUPERSEDED because isActive is what the
  // one-active-per-lead partial unique index enforces; the status is a label set
  // alongside it. Revision ids reach the client via listOfferRevisions, so this
  // is the boundary that stops one being replayed into a mutation.
  if (!offer.isActive && options?.allowInactive !== true) {
    return {
      ok: false,
      error: "This offer revision has been superseded and is read-only.",
    };
  }
  return { ok: true, user, leadId: offer.leadId, isActive: offer.isActive };
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
    await assertCanAccessLead(user, leadId);
  } catch {
    return { ok: false, error: "You do not have access to this lead." };
  }
  return { ok: true, user };
}
