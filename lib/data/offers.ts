"use server";
import { LeadStage, OfferStatus, Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { startOfWeek, subWeeks } from "date-fns";
import { OfferKPIs, OfferWithItemsAndFiles, PaginatedOfferResult, SafeOfferDBFile, SafeOfferItem } from "@/types/offer";
import type { OfferFile } from "@/context/ChatContext";
import { calculateTrend } from "@/utils/formatters";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";
import { createOrUpdateOfferInternal, type CreateOfferInput } from "@/lib/data/offers-internal";

export async function getOffers(page?: number, limit?: number, q?: string): Promise<PaginatedOfferResult> {
    const safePage = Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1;
    const safeLimit = Number.isFinite(limit) && (limit ?? 12) > 0 ? Math.min(Math.floor(limit ?? 12), 100) : 12;
    const safeQuery = (q && q.trim() !== "") ? q.trim() : undefined;
    try {
        const whereClause: Prisma.OfferWhereInput[] = [];
        if (safeQuery) {
            whereClause.push({
                OR: [
                    {
                        lead: {
                            name: { contains: safeQuery, mode: "insensitive" },
                            email: { contains: safeQuery, mode: "insensitive" },
                            phone: { contains: safeQuery, mode: "insensitive" },
                            location: { contains: safeQuery, mode: "insensitive" },
                        }
                    }
                ],
            });
        }
        const [offers, totalCount] = await Promise.all([
            prisma.offer.findMany({
                where: { AND: whereClause },
                include: {
                    lead: true,
                    offerFiles: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        select: {
                            version: true,
                        }
                    },
                },
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
            }),
            prisma.offer.count({
                where: { AND: whereClause },
            }),
        ]);
        const totalPages = Math.ceil(totalCount / safeLimit);

        return {
            items: offers.map(({ offerFiles, ...offer }) => ({
                ...offer,
                amount: offer.amount.toString(),
                gstAmount: offer.gstAmount.toString(),
                totalAmount: offer.totalAmount.toString(),
                version: offerFiles[0]?.version ?? 1,
            })),
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages,
        };
    } catch (error) {
        console.error("Error fetching offers:", error);
        return {
            items: [],
            page: safePage,
            limit: safeLimit,
            totalCount: 0,
            totalPages: 1,
        };
    }
}

export async function getOfferByLeadId(id: number): Promise<OfferWithItemsAndFiles | null> {
    try {
        const offerData = await prisma.offer.findUnique({
            where: { leadId: id },
            include: {
                lead: true,
                offerItems: true,
                offerFiles: true,
            },
        });


        if (!offerData) {
            console.warn(`No offer found for lead ID: ${id}`);
            return null;
        }

        const { offerItems, offerFiles, ...offer } = offerData;
        const currentVersion = offerFiles.reduce((max, file) => Math.max(max, file.version), 0);
        const offerItemsRecord: Record<number, SafeOfferItem[]> = {};
        const filesRecord: Record<number, SafeOfferDBFile> = {};
        offerItems.forEach(item => {
            if (!offerItemsRecord[item.version]) {
                offerItemsRecord[item.version] = [];
            }
            offerItemsRecord[item.version].push({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            });
        });
        offerFiles.forEach(file => {
            filesRecord[file.version] = {
                ...file,
                offerContent: file.offerContent as OfferFile,
            };
        });

        return {
            ...offer,
            amount: offer.amount.toString(),
            gstAmount: offer.gstAmount.toString(),
            totalAmount: offer.totalAmount.toString(),
            version: currentVersion,
            items: offerItemsRecord,
            files: filesRecord,
        };
    } catch (error) {
        console.error("Error fetching offer by ID:", error);
        throw error;
    }
}


type OfferKPIQueryResult = {
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

export async function getOfferKPIs(): Promise<OfferKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, {
            weekStartsOn: 1,
        });

        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const [result] = await prisma.$queryRaw<OfferKPIQueryResult[]>`
            SELECT
                COUNT(*) AS all_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'PENDING'
                ) AS pending_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'ACCEPTED'
                ) AS approved_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'REJECTED'
                ) AS rejected_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'SENT'
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
                    WHERE "offerStatus" = 'ACCEPTED'
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS approved_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'ACCEPTED'
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS approved_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'REJECTED'
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS rejected_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'REJECTED'
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS rejected_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'SENT'
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS sent_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" = 'SENT'
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS sent_current_week
            FROM "Offer"
        `;

        return {
            allOffers: calculateTrend(
                Number(result.all_current_week),
                Number(result.all_previous_week),
            ),

            pendingOffers: calculateTrend(
                Number(result.pending_current_week),
                Number(result.pending_previous_week),
            ),
            approvedOffers: calculateTrend(
                Number(result.approved_current_week),
                Number(result.approved_previous_week),
            ),

            rejectedOffers: calculateTrend(
                Number(result.rejected_current_week),
                Number(result.rejected_previous_week),
            ),
            sentOffers: calculateTrend(
                Number(result.sent_current_week),
                Number(result.sent_previous_week),
            ),
        };
    } catch (error) {
        console.error("Error fetching offer KPIs:", error);

        return {
            allOffers: { total: 0, trendDelta: 0 },
            pendingOffers: { total: 0, trendDelta: 0 },
            approvedOffers: { total: 0, trendDelta: 0 },
            rejectedOffers: { total: 0, trendDelta: 0 },
            sentOffers: { total: 0, trendDelta: 0 },
        };
    }
}

export const getOffersCached = async (page?: number, limit?: number, q?: string) => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOffers(page, limit, q);
}

export const getOfferByLeadIdCached = async (id: number) => {
    "use cache";
    cacheTag(`offer-lead-${id}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferByLeadId(id);
}

export const getOfferKPIsCached = async () => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferKPIs();
}

export const createOrUpdateOffer = async ({
    leadId,
    offerFileInput,
    amount,
    gstAmount,
    totalAmount,
    offerItems,
}: CreateOfferInput) => {
    try {
        const { userId } = await auth();
        if (!userId) {
            throw new Error("Unauthorized");
        }

        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("Unauthorized");
        }

        await assertCanAccessLead(user, leadId);

        return createOrUpdateOfferInternal({
            leadId,
            offerFileInput,
            amount,
            gstAmount,
            totalAmount,
            offerItems,
        });
    } catch (error) {
        console.error("Error creating offer:", error);
        throw new Error("Failed to create offer");
    }
}

// Map to determine how lead stage should be updated based on offer status changes
const OFFER_TO_LEAD_STATUS_UPDATE_MAP: Record<OfferStatus, LeadStage> = {
    PENDING: "NEGOTIATING",
    SENT: "NEGOTIATING",
    ACCEPTED: "WON",
    REJECTED: "LOST",
}

const OFFER_STATE_MACHINE: Record<OfferStatus, OfferStatus[]> = {
  PENDING: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["PENDING"],
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
            select: { offerStatus: true, leadId: true },
        });
        
        if (!currentOffer) {
            throw new Error("OFFER_NOT_FOUND");
        }
        
        await assertCanAccessLead(user, currentOffer.leadId);
        const allowedNextStatuses = OFFER_STATE_MACHINE[currentOffer.offerStatus];
        if (!allowedNextStatuses.includes(status)) {
            throw new Error(`Invalid status transition from ${currentOffer.offerStatus} to ${status}`);
        }

        const offer = await prisma.offer.update({
            where: { id: offerId },
            data: { 
                offerStatus: status,
                lead: {
                    update: {
                        stage: OFFER_TO_LEAD_STATUS_UPDATE_MAP[status],
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