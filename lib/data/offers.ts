"use server";

import { auth } from "@clerk/nextjs/server";
import type { OfferStatus } from "@prisma/client";
import type { LeadListSort } from "@/lib/leads/list-sort";
import { revalidateTag } from "next/cache";

import { getUserByClerkId } from "@/lib/data/user";
import {
  emptyOfferGroupResult,
  queryOfferGroups,
} from "@/lib/data/offer-listing";
import { getOfferSummary } from "@/lib/domain/offers/queries";
import { commitOfferStatusTransition } from "@/lib/domain/offers/status";
import { userPrincipal } from "@/lib/domain/principal";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import prisma from "@/lib/prisma";
import { leadListScope } from "@/lib/offer/access";
import { CACHE_PROFILES } from "@/types/cache";
import type {
  OfferStatusBucket,
  PaginatedOfferGroupResult,
} from "@/types/offer";

/** Authorise and load a page of offer groups with the requested search, status and order. */
export async function getOfferGroups(
  page?: number,
  limit?: number,
  q?: string,
  status?: OfferStatusBucket,
  sort?: LeadListSort,
): Promise<PaginatedOfferGroupResult> {
  try {
    const { userId } = await auth();
    const user = userId ? await getUserByClerkId(userId) : null;
    if (!user) return emptyOfferGroupResult(page, limit);
    return queryOfferGroups(page, limit, q, status, leadListScope(user), sort);
  } catch (error) {
    console.error("Error authorizing the offer listing:", error);
    return emptyOfferGroupResult(page, limit);
  }
}

/** Legacy list control, now backed by the same lifecycle command as Eve. */
export async function updateOfferStatus(offerId: string, status: OfferStatus) {
  try {
    const { userId } = await auth();
    const user = userId ? await getUserByClerkId(userId) : null;
    if (!user) throw new Error("Unauthorized");
    const principal = userPrincipal(user);
    const committed = await commitOfferStatusTransition(
      principal,
      { offerId, toStatus: status },
      prisma,
    );
    if (!committed) {
      throw new Error("The offer changed while it was being updated.");
    }
    await syncLeadStageForOffer(offerId);
    const offer = await getOfferSummary(principal, offerId, prisma);
    revalidateTag(`offer-lead-${offer.leadId}`, CACHE_PROFILES.SHORT);
    revalidateTag("offers", CACHE_PROFILES.SHORT);
    return {
      id: offer.id,
      leadId: offer.leadId,
      offerStatus: offer.offerStatus,
    };
  } catch (error) {
    console.error("Error updating offer status:", error);
    throw new Error("Failed to update offer status");
  }
}
