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
  | { ok: true; user: User; leadId: number }
  | { ok: false; error: string };

export async function authorizeOfferAccess(
  offerId: string,
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
    select: { leadId: true },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  try {
    await assertCanAccessLead(user, offer.leadId);
  } catch {
    return { ok: false, error: "You do not have access to this offer." };
  }
  return { ok: true, user, leadId: offer.leadId };
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
