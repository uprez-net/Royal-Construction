"use server";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { startOfWeek, subWeeks } from "date-fns";
import { OfferKPIs, OfferWithItems, PaginatedOfferResult } from "@/types/offer";

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
            items: offers.map(offer => ({
                ...offer,
                amount: offer.amount.toString(),
                gstAmount: offer.gstAmount.toString(),
                totalAmount: offer.totalAmount.toString(),
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

export async function getOfferById(id: string): Promise<OfferWithItems | null> {
    try {
        const offer = await prisma.offer.findUnique({
            where: { id },
            include: {
                lead: true,
                offerItems: true,
            },
        });

        if (!offer) {
            throw new Error(`Offer with ID ${id} not found`);
        }

        return {
            ...offer,
            amount: offer.amount.toString(),
            gstAmount: offer.gstAmount.toString(),
            totalAmount: offer.totalAmount.toString(),
            items: offer.offerItems.map(item => ({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            })) ?? [],
        };
    } catch (error) {
        console.error("Error fetching offer by ID:", error);
        return null;
    }
}

function calculateTrend(current: number, previous: number) {
    if (previous === 0) {
        return current > 0 ? 100 : 0;
    }

    return ((current - previous) / previous) * 100;
}

export async function getOfferKPIs(): Promise<OfferKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const [
            allOffers,

            pendingOffers,
            approvedOffers,
            rejectedOffers,
            sentOffers,

            allPreviousWeek,
            allCurrentWeek,

            pendingPreviousWeek,
            pendingCurrentWeek,

            approvedPreviousWeek,
            approvedCurrentWeek,

            rejectedPreviousWeek,
            rejectedCurrentWeek,

            sentPreviousWeek,
            sentCurrentWeek,
        ] = await Promise.all([
            // Totals
            prisma.offer.count(),

            prisma.offer.count({
                where: { offerStatus: "PENDING" },
            }),
            prisma.offer.count({
                where: { offerStatus: "ACCEPTED" },
            }),
            prisma.offer.count({
                where: { offerStatus: "REJECTED" },
            }),
            prisma.offer.count({
                where: { offerStatus: "SENT" },
            }),

            // All Offers Trend (created this week vs last week)
            prisma.offer.count({
                where: {
                    createdAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    createdAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Pending Trend
            prisma.offer.count({
                where: {
                    offerStatus: "PENDING",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "PENDING",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Approved Trend
            prisma.offer.count({
                where: {
                    offerStatus: "ACCEPTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "ACCEPTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Rejected Trend
            prisma.offer.count({
                where: {
                    offerStatus: "REJECTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "REJECTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Sent Trend
            prisma.offer.count({
                where: {
                    offerStatus: "SENT",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "SENT",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),
        ]);

        return {
            allOffers: {
                total: allOffers,
                trendDelta: calculateTrend(allCurrentWeek, allPreviousWeek),
            },
            pendingOffers: {
                total: pendingOffers,
                trendDelta: calculateTrend(
                    pendingCurrentWeek,
                    pendingPreviousWeek,
                ),
            },
            approvedOffers: {
                total: approvedOffers,
                trendDelta: calculateTrend(
                    approvedCurrentWeek,
                    approvedPreviousWeek,
                ),
            },
            rejectedOffers: {
                total: rejectedOffers,
                trendDelta: calculateTrend(
                    rejectedCurrentWeek,
                    rejectedPreviousWeek,
                ),
            },
            sentOffers: {
                total: sentOffers,
                trendDelta: calculateTrend(
                    sentCurrentWeek,
                    sentPreviousWeek,
                ),
            },
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

export const getOfferByIdCached = async (id: string) => {
    "use cache";
    cacheTag(`offer-${id}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferById(id);
}

export const getOfferKPIsCached = async () => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferKPIs();
}

interface CreateOfferInput {
    leadId: number;
    offerFileId: string;
    amount: string;
    gstAmount: string;
    totalAmount: string;
    offerItems: {
        item: string;
        description: string;
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        unit: string;
    }[];
}

export const createOffer = async ({
    leadId,
    offerFileId,
    amount,
    gstAmount,
    totalAmount,
    offerItems
}: CreateOfferInput) => {
    try {
        const newOffer = await prisma.offer.create({
            data: {
                leadId,
                amount: new Prisma.Decimal(amount),
                gstAmount: new Prisma.Decimal(gstAmount),
                totalAmount: new Prisma.Decimal(totalAmount),
                offerItems: {
                    create: offerItems.map(item => ({
                        item: item.item,
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: new Prisma.Decimal(item.unitPrice),
                        totalPrice: new Prisma.Decimal(item.totalPrice),
                        unit: item.unit,
                    })),
                },
                files: {
                    connect: {
                        id: offerFileId,
                    },
                },
            },
            include: {
                offerItems: true,
            },
        });

        revalidateTag("offers", CACHE_PROFILES.MEDIUM);
        revalidateTag(`offer-${newOffer.id}`, CACHE_PROFILES.MEDIUM);

        return {
            ...newOffer,
            amount: newOffer.amount.toString(),
            gstAmount: newOffer.gstAmount.toString(),
            totalAmount: newOffer.totalAmount.toString(),
            items: newOffer.offerItems.map(item => ({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            })) ?? [],
        };
    } catch (error) {
        console.error("Error creating offer:", error);
        throw new Error("Failed to create offer");
    }
}