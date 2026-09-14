"use server";
import { LeadStage, OfferStatus } from "@prisma/client";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { OfferStatusBucket, PaginatedOfferGroupResult } from "@/types/offer";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertCanAccessLead, leadListScope } from "@/lib/offer/access";
import { closeDatePatch } from "@/lib/leads/pipeline-stages";
import { emptyOfferGroupResult, queryOfferGroups } from "@/lib/data/offer-listing";

/**
 * The offers table's reads after first paint: tab, search and page changes.
 *
 * A Server Action, and the store that calls it is mounted from the root layout,
 * so its action ID ships to every page, public ones included. Nothing the
 * browser sends can widen the result: the scope comes from the session, by the
 * same rule the offer page applies (leadListScope), and a request without an
 * internal user gets an empty page rather than an error.
 */
export async function getOfferGroups(
    page?: number,
    limit?: number,
    q?: string,
    status?: OfferStatusBucket,
): Promise<PaginatedOfferGroupResult> {
    try {
        const { userId } = await auth();
        const user = userId ? await getUserByClerkIdCached(userId) : null;
        if (!user) {
            return emptyOfferGroupResult(page, limit);
        }
        return await queryOfferGroups(page, limit, q, status, leadListScope(user));
    } catch (error) {
        console.error("Error authorizing the offer listing:", error);
        return emptyOfferGroupResult(page, limit);
    }
}

// Map to determine how lead stage should be updated based on offer status changes
const OFFER_TO_LEAD_STATUS_UPDATE_MAP: Record<OfferStatus, LeadStage> = {
    PENDING: "NEGOTIATING",
    SENT: "NEGOTIATING",
    ACCEPTED: "WON",
    // NEGOTIATING, not LOST. A rejected offer is not a lost lead — REJECTED is
    // explicitly reversible (the state machine allows REJECTED -> PENDING), and
    // the three modern declined statuses below all map to NEGOTIATING for the
    // same reason. It also closes a data-integrity hole: this path writes
    // lead.stage through a nested update rather than updateLead, so it bypassed
    // the rule that a lead cannot enter LOST without a recorded reason, and was
    // producing LOST rows with a null lostReason that land in the "Unknown"
    // slice of the non-conversion charts. Closing a lead stays a human action.
    REJECTED: "NEGOTIATING",
    // Offer-acceptance signing (ADR 0004) is pre-agreed, so still negotiating.
    OFFER_SENT: "NEGOTIATING",
    OFFER_SIGNED: "NEGOTIATING",
    OFFER_DECLINED: "NEGOTIATING",
    // Once scope + price are agreed the deal is effectively won.
    AGREED: "WON",
    TENDER_DRAFT: "WON",
    TENDER_SENT: "WON",
    TENDER_SIGNED: "WON",
    // Declined states are set directly by the DocuSign webhook, not through
    // updateOfferStatus (this map's only reader), so these two entries exist to
    // satisfy the exhaustive Record; NEGOTIATING is the value to use if lead-stage
    // sync from the offer lifecycle is ever wired up.
    TENDER_DECLINED: "NEGOTIATING",
    CONTRACT_DRAFT: "WON",
    CONTRACT_SENT: "WON",
    CONTRACT_SIGNED: "WON",
    CONTRACT_DECLINED: "NEGOTIATING",
    PROJECT: "WON",
    SUPERSEDED: "NEGOTIATING",
}

// Legacy server-side transitions; the new lifecycle states progress via the
// offer workspace's own actions, so they are terminal here.
const OFFER_STATE_MACHINE: Record<OfferStatus, OfferStatus[]> = {
  PENDING: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["PENDING"],
  OFFER_SENT: [],
  OFFER_SIGNED: [],
  OFFER_DECLINED: [],
  AGREED: [],
  TENDER_DRAFT: [],
  TENDER_SENT: [],
  TENDER_SIGNED: [],
  TENDER_DECLINED: [],
  CONTRACT_DRAFT: [],
  CONTRACT_SENT: [],
  CONTRACT_SIGNED: [],
  CONTRACT_DECLINED: [],
  PROJECT: [],
  SUPERSEDED: [],
};
/**
 * Updates the status of an offer and transitions the associated lead stage accordingly
 * @param offerId 
 * @param leadId 
 * @param status 
 * @returns The updated offer object
 * @throws Error if the user is unauthorized, the offer is not found, or the status transition is invalid
 */
export const updateOfferStatus = async (offerId: string, status: OfferStatus) => {
    try {
        const { userId } = await auth();
        if (!userId) {
            throw new Error("Unauthorized");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("Unauthorized");
        }

        
        const currentOffer = await prisma.offer.findUnique({
            where: { id: offerId },
            // lead.stage is needed to work out the wonAt/lostAt patch below.
            select: { offerStatus: true, leadId: true, lead: { select: { stage: true } } },
        });
        
        if (!currentOffer) {
            throw new Error("OFFER_NOT_FOUND");
        }
        
        await assertCanAccessLead(user, currentOffer.leadId);
        const allowedNextStatuses = OFFER_STATE_MACHINE[currentOffer.offerStatus];
        if (!allowedNextStatuses.includes(status)) {
            throw new Error(`Invalid status transition from ${currentOffer.offerStatus} to ${status}`);
        }

        // Most real wins are recorded through THIS path, not the lead modal —
        // ACCEPTED/AGREED/TENDER_*/CONTRACT_*/PROJECT all map to WON. Stamping
        // only in updateLead would leave the forecast blind to them.
        const nextLeadStage = OFFER_TO_LEAD_STATUS_UPDATE_MAP[status];
        const offer = await prisma.offer.update({
            where: { id: offerId },
            data: {
                offerStatus: status,
                lead: {
                    update: {
                        stage: nextLeadStage,
                        ...closeDatePatch(
                            currentOffer.lead?.stage ?? null,
                            nextLeadStage,
                            new Date(),
                        ),
                    }
                }
            },
        });

        revalidateTag(`offer-lead-${offer.leadId}`, CACHE_PROFILES.SHORT);
        revalidateTag("offers", CACHE_PROFILES.SHORT);

        return offer;
    } catch (error) {
        console.error("Error updating offer status:", error);
        throw new Error("Failed to update offer status");
    }
}