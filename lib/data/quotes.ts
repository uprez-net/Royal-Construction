"use server";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { PaginatedQuotesResult, QuoteKPIs, QuoteWithItems } from "@/types/quote";
import { startOfWeek, subWeeks } from "date-fns";

export async function getQuotes(page?: number, limit?: number, q?: string): Promise<PaginatedQuotesResult> {
    const safePage = Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1;
    const safeLimit = Number.isFinite(limit) && (limit ?? 12) > 0 ? Math.min(Math.floor(limit ?? 12), 100) : 12;
    const safeQuery = (q && q.trim() !== "") ? q.trim() : undefined;
    try {
        const whereClause: Prisma.QuoteWhereInput[] = [];
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
        const [quotes, totalCount] = await Promise.all([
            prisma.quote.findMany({
                where: { AND: whereClause },
                include: {
                    lead: true,
                },
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
            }),
            prisma.quote.count({
                where: { AND: whereClause },
            }),
        ]);
        const totalPages = Math.ceil(totalCount / safeLimit);

        return {
            items: quotes.map(quote => ({
                ...quote,
                amount: quote.amount.toString(),
                gstAmount: quote.gstAmount.toString(),
                totalAmount: quote.totalAmount.toString(),
            })),
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages,
        };
    } catch (error) {
        console.error("Error fetching quotes:", error);
        return {
            items: [],
            page: safePage,
            limit: safeLimit,
            totalCount: 0,
            totalPages: 1,
        };
    }
}

export async function getQuoteById(id: string): Promise<QuoteWithItems | null> {
    try {
        const quote = await prisma.quote.findUnique({
            where: { id },
            include: {
                lead: true,
                quoteItems: true,
            },
        });

        if (!quote) {
            throw new Error(`Quote with ID ${id} not found`);
        }

        return {
            ...quote,
            amount: quote.amount.toString(),
            gstAmount: quote.gstAmount.toString(),
            totalAmount: quote.totalAmount.toString(),
            items: quote.quoteItems.map(item => ({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            })) ?? [],
        };
    } catch (error) {
        console.error("Error fetching quote by ID:", error);
        return null;
    }
}

function calculateTrend(current: number, previous: number) {
    if (previous === 0) {
        return current > 0 ? 100 : 0;
    }

    return ((current - previous) / previous) * 100;
}

export async function getQuoteKPIs(): Promise<QuoteKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const [
            allQuotes,

            pendingQuotes,
            approvedQuotes,
            rejectedQuotes,
            sentQuotes,

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
            prisma.quote.count(),

            prisma.quote.count({
                where: { quoteStatus: "PENDING" },
            }),
            prisma.quote.count({
                where: { quoteStatus: "ACCEPTED" },
            }),
            prisma.quote.count({
                where: { quoteStatus: "REJECTED" },
            }),
            prisma.quote.count({
                where: { quoteStatus: "SENT" },
            }),

            // All Quotes Trend (created this week vs last week)
            prisma.quote.count({
                where: {
                    createdAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.quote.count({
                where: {
                    createdAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Pending Trend
            prisma.quote.count({
                where: {
                    quoteStatus: "PENDING",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.quote.count({
                where: {
                    quoteStatus: "PENDING",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Approved Trend
            prisma.quote.count({
                where: {
                    quoteStatus: "ACCEPTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.quote.count({
                where: {
                    quoteStatus: "ACCEPTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Rejected Trend
            prisma.quote.count({
                where: {
                    quoteStatus: "REJECTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.quote.count({
                where: {
                    quoteStatus: "REJECTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Sent Trend
            prisma.quote.count({
                where: {
                    quoteStatus: "SENT",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.quote.count({
                where: {
                    quoteStatus: "SENT",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),
        ]);

        return {
            allQuotes: {
                total: allQuotes,
                trendDelta: calculateTrend(allCurrentWeek, allPreviousWeek),
            },
            pendingQuotes: {
                total: pendingQuotes,
                trendDelta: calculateTrend(
                    pendingCurrentWeek,
                    pendingPreviousWeek,
                ),
            },
            approvedQuotes: {
                total: approvedQuotes,
                trendDelta: calculateTrend(
                    approvedCurrentWeek,
                    approvedPreviousWeek,
                ),
            },
            rejectedQuotes: {
                total: rejectedQuotes,
                trendDelta: calculateTrend(
                    rejectedCurrentWeek,
                    rejectedPreviousWeek,
                ),
            },
            sentQuotes: {
                total: sentQuotes,
                trendDelta: calculateTrend(
                    sentCurrentWeek,
                    sentPreviousWeek,
                ),
            },
        };
    } catch (error) {
        console.error("Error fetching quote KPIs:", error);

        return {
            allQuotes: { total: 0, trendDelta: 0 },
            pendingQuotes: { total: 0, trendDelta: 0 },
            approvedQuotes: { total: 0, trendDelta: 0 },
            rejectedQuotes: { total: 0, trendDelta: 0 },
            sentQuotes: { total: 0, trendDelta: 0 },
        };
    }
}

export const getQuotesCached = async (page?: number, limit?: number, q?: string) => {
    "use cache";
    cacheTag("quotes");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getQuotes(page, limit, q);
}

export const getQuoteByIdCached = async (id: string) => {
    "use cache";
    cacheTag(`quote-${id}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getQuoteById(id);
}

export const getQuoteKPIsCached = async () => {
    "use cache";
    cacheTag("quotes");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getQuoteKPIs();
}

interface CreateQuoteInput {
    leadId: number;
    amount: string;
    gstAmount: string;
    totalAmount: string;
    quoteItems: {
        item: string;
        description: string;
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        unit: string;
    }[];
}

export const createQuote = async ({
    leadId,
    amount,
    gstAmount,
    totalAmount,
    quoteItems
}: CreateQuoteInput) => {
    try {
        const newQuote = await prisma.quote.create({
            data: {
                leadId,
                amount: new Prisma.Decimal(amount),
                gstAmount: new Prisma.Decimal(gstAmount),
                totalAmount: new Prisma.Decimal(totalAmount),
                quoteItems: {
                    create: quoteItems.map(item => ({
                        item: item.item,
                        description: item.description,
                        quantity: item.quantity,
                        unitPrice: new Prisma.Decimal(item.unitPrice),
                        totalPrice: new Prisma.Decimal(item.totalPrice),
                        unit: item.unit,
                    })),
                },
            },
            include: {
                quoteItems: true,
            },
        });

        revalidateTag("quotes", CACHE_PROFILES.MEDIUM);
        revalidateTag(`quote-${newQuote.id}`, CACHE_PROFILES.MEDIUM);

        return {
            ...newQuote,
            amount: newQuote.amount.toString(),
            gstAmount: newQuote.gstAmount.toString(),
            totalAmount: newQuote.totalAmount.toString(),
            items: newQuote.quoteItems.map(item => ({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            })) ?? [],
        };
    } catch (error) {
        console.error("Error creating quote:", error);
        throw new Error("Failed to create quote");
    }
}