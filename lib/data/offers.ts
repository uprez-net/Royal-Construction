"use server";
import { LeadStage, OfferStatus, Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { startOfWeek, subWeeks } from "date-fns";
import { KPIResult, OfferGroup, OfferKPIs, OfferWithLead, PaginatedOfferGroupResult } from "@/types/offer";
import { calculateTrend } from "@/utils/formatters";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";
import { closeDatePatch } from "@/lib/leads/pipeline-stages";

/**
 * Offer listing, grouped into one row per lead.
 *
 * A lead accumulates one `Offer` row per revision, so a flat listing showed the
 * same client three or four times over. Pagination therefore runs over leads
 * (the unit the table renders) and every revision for the leads on the page is
 * fetched alongside them, which is what the expandable version history reads.
 */
export async function getOfferGroups(page?: number, limit?: number, q?: string): Promise<PaginatedOfferGroupResult> {
    const safePage = Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1;
    const safeLimit = Number.isFinite(limit) && (limit ?? 12) > 0 ? Math.min(Math.floor(limit ?? 12), 100) : 12;
    const safeQuery = (q && q.trim() !== "") ? q.trim() : undefined;
    try {
        // `some: {}` keeps out leads that have never been offered on. The search
        // terms are OR'd: nesting them in one object (as the flat query did)
        // AND's them, so a name match only counted when the email, phone and
        // location all matched the same string too.
        const leadWhere: Prisma.LeadWhereInput = {
            offers: { some: {} },
            ...(safeQuery
                ? {
                    OR: [
                        { name: { contains: safeQuery, mode: "insensitive" } },
                        { email: { contains: safeQuery, mode: "insensitive" } },
                        { phone: { contains: safeQuery, mode: "insensitive" } },
                        { location: { contains: safeQuery, mode: "insensitive" } },
                    ],
                }
                : {}),
        };

        const [leads, totalCount, totalOfferCount] = await Promise.all([
            prisma.lead.findMany({
                where: leadWhere,
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
                include: {
                    offers: {
                        orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
                        include: {
                            offerFiles: {
                                orderBy: { version: "desc" },
                                take: 1,
                                select: { version: true },
                            },
                        },
                    },
                },
            }),
            prisma.lead.count({ where: leadWhere }),
            prisma.offer.count({ where: { lead: leadWhere } }),
        ]);

        const items = leads.flatMap<OfferGroup>((leadRow) => {
            const { offers, ...lead } = leadRow;

            const revisions: OfferWithLead[] = offers.map(({ offerFiles, ...offer }) => ({
                ...offer,
                amount: offer.amount.toString(),
                gstAmount: offer.gstAmount.toString(),
                totalAmount: offer.totalAmount.toString(),
                contractValueIncGst: offer.contractValueIncGst?.toString() ?? null,
                version: offerFiles[0]?.version ?? 1,
                lead,
            }));

            // `some: {}` guarantees at least one, but a lead with none must not
            // become a row with an undefined `latest`.
            const latest = revisions.find((revision) => revision.isActive) ?? revisions[0];
            if (!latest) return [];

            return [{
                leadId: lead.id,
                lead,
                reference: latest.baseReference || `OF-${lead.id}`,
                latest,
                revisions,
                versionCount: revisions.length,
            }];
        });

        return {
            items,
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalOfferCount,
            totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        };
    } catch (error) {
        console.error("Error fetching offers:", error);
        return {
            items: [],
            page: safePage,
            limit: safeLimit,
            totalCount: 0,
            totalOfferCount: 0,
            totalPages: 1,
        };
    }
}

type OfferKPIQueryResult = {
    total_versions: bigint;

    all_offers: bigint;

    pending_offers: bigint;
    approved_offers: bigint;
    rejected_offers: bigint;
    sent_offers: bigint;

    all_previous_week: bigint;
    all_current_week: bigint;

    pending_previous_week: bigint;
    pending_current_week: bigint;

    approved_previous_week: bigint;
    approved_current_week: bigint;

    rejected_previous_week: bigint;
    rejected_current_week: bigint;

    sent_previous_week: bigint;
    sent_current_week: bigint;
};

/**
 * The headline number is the running total; `calculateTrend` returns the current
 * week as its `total`, which is why every card used to read as a weekly count
 * while the `*_offers` columns went unused. Only the percentage is taken from it.
 */
const offerKPI = (total: bigint, current: bigint, previous: bigint): KPIResult => ({
    total: Number(total),
    trendDelta: calculateTrend(Number(current), Number(previous)).trendDelta,
});

/**
 * Counts leads, not `Offer` rows, so the cards agree with the grouped table.
 *
 * Each lead is represented by one revision — the active one, else the highest
 * revision number — picked by DISTINCT ON, so a lead with four revisions counts
 * once and lands in the status bucket of the revision that is actually live.
 */
export async function getOfferKPIs(): Promise<OfferKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, {
            weekStartsOn: 1,
        });

        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const [result] = await prisma.$queryRaw<OfferKPIQueryResult[]>`
            WITH representative AS (
                SELECT DISTINCT ON ("leadId") *
                FROM "Offer"
                ORDER BY "leadId", "isActive" DESC, "revisionNumber" DESC, "createdAt" DESC
            )
            SELECT
                (SELECT COUNT(*) FROM "Offer") AS total_versions,

                COUNT(*) AS all_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'PENDING'
                ) AS pending_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('ACCEPTED', 'AGREED', 'TENDER_DRAFT', 'TENDER_SENT', 'TENDER_SIGNED', 'CONTRACT_DRAFT', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PROJECT')
                ) AS approved_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('REJECTED', 'OFFER_DECLINED', 'TENDER_DECLINED', 'CONTRACT_DECLINED')
                ) AS rejected_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('SENT', 'TENDER_SENT', 'CONTRACT_SENT')
                ) AS sent_offers,

                COUNT(*) FILTER (
                    WHERE "createdAt" >= ${previousWeekStart}
                    AND "createdAt" < ${currentWeekStart}
                ) AS all_previous_week,

                COUNT(*) FILTER (
                    WHERE "createdAt" >= ${currentWeekStart}
                ) AS all_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'PENDING'
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS pending_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'PENDING'
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS pending_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('ACCEPTED', 'AGREED', 'TENDER_DRAFT', 'TENDER_SENT', 'TENDER_SIGNED', 'CONTRACT_DRAFT', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PROJECT')
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS approved_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('ACCEPTED', 'AGREED', 'TENDER_DRAFT', 'TENDER_SENT', 'TENDER_SIGNED', 'CONTRACT_DRAFT', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PROJECT')
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS approved_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('REJECTED', 'OFFER_DECLINED', 'TENDER_DECLINED', 'CONTRACT_DECLINED')
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS rejected_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('REJECTED', 'OFFER_DECLINED', 'TENDER_DECLINED', 'CONTRACT_DECLINED')
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS rejected_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('SENT', 'TENDER_SENT', 'CONTRACT_SENT')
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS sent_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" in ('SENT', 'TENDER_SENT', 'CONTRACT_SENT')
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS sent_current_week
            FROM representative
        `;

        return {
            totalVersions: Number(result.total_versions),

            allOffers: offerKPI(
                result.all_offers,
                result.all_current_week,
                result.all_previous_week,
            ),

            pendingOffers: offerKPI(
                result.pending_offers,
                result.pending_current_week,
                result.pending_previous_week,
            ),
            approvedOffers: offerKPI(
                result.approved_offers,
                result.approved_current_week,
                result.approved_previous_week,
            ),

            rejectedOffers: offerKPI(
                result.rejected_offers,
                result.rejected_current_week,
                result.rejected_previous_week,
            ),
            sentOffers: offerKPI(
                result.sent_offers,
                result.sent_current_week,
                result.sent_previous_week,
            ),
        };
    } catch (error) {
        console.error("Error fetching offer KPIs:", error);

        return {
            totalVersions: 0,
            allOffers: { total: 0, trendDelta: 0 },
            pendingOffers: { total: 0, trendDelta: 0 },
            approvedOffers: { total: 0, trendDelta: 0 },
            rejectedOffers: { total: 0, trendDelta: 0 },
            sentOffers: { total: 0, trendDelta: 0 },
        };
    }
}

export const getOfferGroupsCached = async (page?: number, limit?: number, q?: string) => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferGroups(page, limit, q);
}

export const getOfferKPIsCached = async () => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferKPIs();
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