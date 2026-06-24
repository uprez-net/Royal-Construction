'use server';
import type {
    ApprovalInput,
    CreateTradieInput,
    DeleteInput,
    IncidentReportApprovalPayload,
    RatingInput,
    ReportIncidentInput,
    TradieDetails,
    TradieRow,
    TradiesByCategory,
    TradieTableQuery,
    UpdatePriceApprovalPayload,
    UpdatePriceInput
} from "@/types/tradie";
import prisma from "../prisma";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { TradieApprovalActionType, TradieIncident, Prisma } from "@prisma/client";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { after } from "next/server"
import { DataPoint } from "@/components/common/metric-card";
import { startOfMonth, subMonths } from "date-fns";
import { calculateTrend, dateFormat } from "@/utils/formatters";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

/**
 * Creates a new tradie record and returns a mapped tradie row.
 *
 * @param input - Tradie creation payload.
 * @returns Newly created tradie formatted for table display.
 * @throws Error if the tradie cannot be created.
 */
export async function createTradie(input: CreateTradieInput): Promise<TradieRow> {
    try {
        const res = await prisma.tradie.create({
            data: input
        });

        return {
            id: res.id,
            name: res.name,
            trade: res.trade,
            isFavourite: res.isFavourite,
            hourlyRate: res.hourlyRate ? res.hourlyRate.toString() : null,
            rating: res.rating ? res.rating.toString() : null,
            jobsCompleted: 0,
            incidentCount: {
                open: 0,
                resolved: 0
            }
        };
    } catch (error) {
        console.error("Error creating tradie:", error);
        throw new Error("Failed to create tradie");
    }
}

/**
 * Retrieves a tradie with ratings, incidents, and completed job statistics.
 *
 * @param tradieId - Tradie identifier.
 * @returns Detailed tradie information or null if not found.
 */
export async function getTradieById(tradieId: string): Promise<TradieDetails | null> {
    try {
        const tradie = await prisma.tradie.findUnique({
            where: { id: tradieId },
            include: {
                ratings: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                incidents: true,
                schedules: {
                    select: {
                        id: true,
                        status: true
                    },
                    where: {
                        status: "COMPLETED"
                    }
                }
            }
        });

        if (!tradie) {
            return null;
        }

        return {
            ...tradie,
            hourlyRate: tradie.hourlyRate?.toString(),
            rating: tradie.rating?.toString(),
            jobsCompleted: tradie.schedules.length,
            reviews: tradie.ratings.map(r => ({
                ...r,
                rating: r.rating.toString(),
                user: {
                    id: r.user.id,
                    name: r.user.name
                }
            })),
            incidents: tradie.incidents
        };
    } catch (error) {
        console.error("Error fetching tradie details:", error);
        return null;
    }
}

/**
 * Cached wrapper around {@link getTradieById}.
 * `CACHED` version of `getTradieById` that retrieves a tradie with ratings, incidents, and completed job statistics.
 * Uses caching to improve performance for frequently accessed tradie details.
 * 
 * Retrieves a tradie with ratings, incidents, and completed job statistics.
 *
 * @param tradieId - Tradie identifier.
 * @returns Detailed tradie information or null if not found.
 */
export async function getTradieByIdCached(tradieId: string): Promise<TradieDetails | null> {
    'use cache';
    cacheTag(`tradie-${tradieId}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getTradieById(tradieId);
}

/**
 * Creates an approval request for updating a tradie's hourly rate.
 *
 * Requires an authenticated user.
 *
 * @param input - Price update request details.
 * @throws Error if the user, tradie, or approval request creation fails.
 */
export async function updateTradiePrice(input: UpdatePriceInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }

        const approval = await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.PRICE_CHANGE,
                reason: input.reason,
                updationData: {
                    newHourlyRate: input.newHourlyRate,
                }
            },
            select: {
                id: true
            }
        })

        after(async () => {
            const notificationPayload = createNotification('tradiePriceUpdate', {
                approvalId: approval.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                newPrice: input.newHourlyRate,
                oldPrice: parseFloat((tradie.hourlyRate ?? 0).toString()),
                priceChangeDate: dateFormat.format(new Date()),
            });

            await triggerNotification([ADMIN_USER_ID], notificationPayload);
        })
    } catch (error) {
        console.error("Error updating tradie price:", error);
        throw new Error("Failed to update tradie price");
    }
}

/**
 * Creates an approval request to remove a tradie.
 *
 * Requires an authenticated user.
 *
 * @param input - Tradie removal request details.
 * @throws Error if the user, tradie, or approval request creation fails.
 */
export async function deleteTradie(input: DeleteInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }
        const approval= await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.TRADIE_REMOVAL,
                reason: input.reason,
            },
            select: {
                id: true
            }
        })

        after(async () => {
            const notificationPayload = createNotification('deleteTradieApproval', {
                approvalId: approval.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                tradieEmail: tradie.email,
                tradiePhone: tradie.phone,
                requestedBy: user.name,
            });
            await triggerNotification([ADMIN_USER_ID], notificationPayload);
        });
    } catch (error) {
        console.error("Error deleting tradie:", error);
        throw new Error("Failed to delete tradie");
    }
}

/**
 * Submits a rating for a tradie and recalculates their average rating.
 *
 * Requires an authenticated user.
 *
 * @param input - Rating value and optional review comment.
 * @returns The tradie ID and updated average rating.
 * @throws Error if the user, tradie, or rating operation fails.
 */
export async function rateTradie(input: RatingInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }

        await prisma.tradieRating.create({
            data: {
                tradieId: input.tradieId,
                userId: user.id,
                rating: input.rating,
                comment: input.comment
            }
        });

        const avgRating = await prisma.tradieRating.aggregate({
            where: { tradieId: input.tradieId },
            _avg: {
                rating: true
            }
        });

        await prisma.tradie.update({
            where: { id: input.tradieId },
            data: {
                rating: avgRating._avg.rating ?? 0
            }
        });

        after(() => {
            cacheTag(`tradie-${input.tradieId}`);
            cacheTag('tradie-management');
        });

        return {
            id: tradie.id,
            newRating: (avgRating._avg.rating ?? 0).toString()
        }
    } catch (error) {
        console.error("Error rating tradie:", error);
        throw new Error("Failed to rate tradie");
    }
}
/**
 * Reports a new incident against a tradie and creates an approval workflow
 * for incident resolution review.
 *
 * Creates:
 * - A tradie incident record with the supplied details.
 * - A corresponding approval request used to track and approve the incident's resolution.
 *
 * Requires an authenticated user and a valid tradie.
 *
 * @param input - Incident details including tradie ID, type, severity, and description.
 *
 * @throws Error If:
 * - The user is not authenticated.
 * - The user cannot be found.
 * - The specified tradie does not exist.
 * - The incident or approval request cannot be created.
 */
export async function reportTradieIncident(input: ReportIncidentInput): Promise<TradieIncident> {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }

        const incident = await prisma.tradieIncident.create({
            data: {
                tradieId: input.tradieId,
                type: input.incidentType,
                severity: input.incidentSeverity,
                description: input.incidentDescription,
                files:
                    input.fileIds?.length
                        ? {
                            connect: input.fileIds.map((id) => ({ id })),
                        }
                        : undefined,
            }
        });

        const approvalId = await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
                reason: input.incidentDescription,
                updationData: {
                    incidentId: incident.id,
                    incidentType: input.incidentType,
                    incidentSeverity: input.incidentSeverity,
                    incidentDescription: input.incidentDescription,
                }
            }
        })

        after(async () => {
            cacheTag(`tradie-${input.tradieId}`);
            cacheTag('tradie-management');

            const notificationPayload = createNotification('tradieIncidentReport', {
                approvalId: approvalId.id,
                incidentId: incident.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                incidentDescription: input.incidentDescription,
                incidentDate: new Date().toISOString(),
            });

            await triggerNotification([ADMIN_USER_ID], notificationPayload);
        });

        return incident;
    } catch (error) {
        console.error("Error reporting tradie incident:", error);
        throw new Error("Failed to report tradie incident");
    }
}

/**
 * Retrieves all tradies grouped by trade category with aggregated metrics.
 *
 * Calculates:
 * - Average category rating
 * - Total completed jobs per category
 * - Open and resolved incident counts per tradie
 *
 * @returns Tradies grouped by trade category.
 * @throws Error if the data cannot be retrieved.
 */

export async function getTradieGroupedByCategory(): Promise<TradiesByCategory[]> {
    try {
        const tradies = await prisma.tradie.findMany({
            include: {
                schedules: {
                    select: {
                        id: true,
                        status: true,
                    },
                },
                incidents: {
                    select: {
                        status: true,
                    },
                },
            },
            orderBy: {
                trade: "asc",
            },
        });

        const grouped = new Map<string, TradieRow[]>();

        for (const tradie of tradies) {
            const row: TradieRow = {
                id: tradie.id,
                name: tradie.name,
                trade: tradie.trade,
                isFavourite: tradie.isFavourite,
                hourlyRate: tradie.hourlyRate?.toString() ?? null,
                rating: tradie.rating?.toString() ?? null,

                jobsCompleted: tradie.schedules.filter(
                    (s) => s.status === "COMPLETED",
                ).length,

                incidentCount: {
                    open: tradie.incidents.filter(
                        (i) => i.status === "OPEN",
                    ).length,

                    resolved: tradie.incidents.filter(
                        (i) => i.status === "RESOLVED",
                    ).length,
                },
            };

            const existing = grouped.get(tradie.trade);

            if (existing) {
                existing.push(row);
            } else {
                grouped.set(tradie.trade, [row]);
            }
        }

        return Array.from(grouped.entries()).map(
            ([category, tradies]): TradiesByCategory => {
                const ratings = tradies
                    .map((t) => (t.rating ? Number(t.rating) : null))
                    .filter((r): r is number => r !== null);

                return {
                    category,

                    avgRating:
                        ratings.length > 0
                            ? Number(
                                (
                                    ratings.reduce((sum, rating) => sum + rating, 0) /
                                    ratings.length
                                ).toFixed(1),
                            )
                            : 0,

                    totalCategoryJobsCompleted: tradies.reduce(
                        (sum, tradie) => sum + tradie.jobsCompleted,
                        0,
                    ),

                    tradies,
                };
            },
        );
    } catch (error) {
        console.error("Error fetching tradies grouped by category:", error);
        throw new Error("Failed to fetch tradies grouped by category");
    }
}

/**
 * Cached wrapper around {@link getTradieGroupedByCategory}.
 *
 * Calculates:
 * - Average category rating
 * - Total completed jobs per category
 * - Open and resolved incident counts per tradie
 *
 * @returns `CACHED` Tradies grouped by trade category.
 * @throws Error if the data cannot be retrieved.
 */

export async function getTradieGroupedByCategoryCached(): Promise<TradiesByCategory[]> {
    'use cache';
    cacheTag('tradie-management');
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getTradieGroupedByCategory();
}

/**
 * Retrieves tradies matching the supplied table filters and returns them
 * in a format suitable for UI table rendering.
 *
 * Supported filters:
 * - Text search across tradie name, trade, and ABN.
 * - Trade category.
 * - Minimum rating.
 * - Favourite status.
 * - Flagged tradies (tradies with at least one open incident).
 *
 * Additionally calculates:
 * - Completed job count.
 * - Open incident count.
 * - Resolved incident count.
 *
 * Decimal database values are converted to strings to ensure safe
 * serialization for client-side consumption.
 *
 * @param input - Table query filters and search criteria.
 * @returns A list of tradies enriched with job and incident statistics.
 *
 * @throws Error If the tradies cannot be retrieved.
 */
export async function fetchFilteredTradies(input: TradieTableQuery): Promise<TradieRow[]> {
    try {
        const whereClause: Prisma.TradieWhereInput = {
            ...(input.search ? {
                OR: [
                    { name: { contains: input.search, mode: "insensitive" } },
                    { trade: { contains: input.search, mode: "insensitive" } },
                    { abn: { contains: input.search, mode: "insensitive" } },
                ]
            } : undefined),
            ...(input.category ? { trade: input.category } : undefined),
            ...(input.rating ? { rating: { gte: input.rating } } : undefined),
            ...(input.favourite !== undefined ? { isFavourite: input.favourite } : undefined),
            ...(input.tab === "flagged" ? { incidents: { some: { status: "OPEN" } } } : undefined)
        };

        const tradies = await prisma.tradie.findMany({
            where: whereClause,
            include: {
                schedules: {
                    select: {
                        id: true,
                        status: true,
                    },
                },
                incidents: {
                    select: {
                        status: true,
                    },
                },
            },
            orderBy: {
                trade: "asc",
            },
        });

        return tradies.map(tradie => {
            return {
                ...tradie,
                hourlyRate: tradie.hourlyRate?.toString() ?? null,
                rating: tradie.rating?.toString() ?? null,
                jobsCompleted: tradie.schedules.filter(s => s.status === "COMPLETED").length,
                incidentCount: {
                    open: tradie.incidents.filter(i => i.status === "OPEN").length,
                    resolved: tradie.incidents.filter(i => i.status === "RESOLVED").length,
                }
            };
        });
    } catch (error) {
        console.error("Error fetching filtered tradies:", error);
        throw new Error("Failed to fetch filtered tradies");
    }
}

interface TradieKPIQueryResult {
    registered_tradies: bigint;
    registered_current_month: bigint;
    registered_previous_month: bigint;

    incidents_lodged: bigint;
    incidents_current_month: bigint;
    incidents_previous_month: bigint;

    favourite_tradies: bigint;
    favourites_current_month: bigint;
    favourites_previous_month: bigint;
}

interface TradieKPIData {
    registeredTradies: DataPoint;
    incidentLodged: DataPoint;
    favouriteTradies: DataPoint;
}

/**
 * Fetches KPI metrics for Tradie Management.
 *
 * Retrieves aggregated counts for:
 * - Total registered tradies
 * - Total incidents lodged
 * - Total favourite tradies
 *
 * Trend values are calculated by comparing the current totals against
 * records created during the previous calendar month. All metrics are
 * fetched using a single database query for efficiency.
 *
 * If an error occurs, a fallback object containing zeroed KPI values
 * is returned.
 *
 * @returns A promise resolving to tradie KPI metrics and trend data.
 */
export async function fetchTradieKPIData(): Promise<TradieKPIData> {
    try {
        const currentMonthStart = startOfMonth(new Date());
        const previousMonthStart = subMonths(currentMonthStart, 1);

        const [result] = await prisma.$queryRaw<TradieKPIQueryResult[]>`
            SELECT
                /* Registered Tradies */
                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                ) AS registered_tradies,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "createdAt" >= ${currentMonthStart}
                ) AS registered_current_month,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "createdAt" >= ${previousMonthStart}
                    AND "createdAt" < ${currentMonthStart}
                ) AS registered_previous_month,

                /* Incidents */
                (
                    SELECT COUNT(*)
                    FROM "TradieIncident"
                ) AS incidents_lodged,

                (
                    SELECT COUNT(*)
                    FROM "TradieIncident"
                    WHERE "createdAt" >= ${currentMonthStart}
                ) AS incidents_current_month,

                (
                    SELECT COUNT(*)
                    FROM "TradieIncident"
                    WHERE "createdAt" >= ${previousMonthStart}
                    AND "createdAt" < ${currentMonthStart}
                ) AS incidents_previous_month,

                /* Favourites */
                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "isFavourite" = true
                ) AS favourite_tradies,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "isFavourite" = true
                    AND "createdAt" >= ${currentMonthStart}
                ) AS favourites_current_month,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "isFavourite" = true
                    AND "createdAt" >= ${previousMonthStart}
                    AND "createdAt" < ${currentMonthStart}
                ) AS favourites_previous_month
        `;

        return {
            registeredTradies: calculateTrend(
                Number(result.registered_tradies),
                Number(result.registered_previous_month)
            ),

            incidentLodged: calculateTrend(
                Number(result.incidents_lodged),
                Number(result.incidents_previous_month)
            ),

            favouriteTradies: calculateTrend(
                Number(result.favourite_tradies),
                Number(result.favourites_previous_month)
            ),
        };
    } catch (error) {
        console.error("Error fetching tradie KPI data:", error);

        return {
            registeredTradies: { total: 0, trendDelta: 0 },
            incidentLodged: { total: 0, trendDelta: 0 },
            favouriteTradies: { total: 0, trendDelta: 0 },
        };
    }
}

/**
 * Cached wrapper around {@link fetchTradieKPIData}.
 *
 * Uses Next.js cache directives to reduce database load for frequently
 * accessed dashboard KPI data. Results are tagged under
 * `tradie-management` and cached using the medium cache profile.
 *
 * @returns A promise resolving to cached tradie KPI metrics and trend data.
 */
export async function fetchTradieKPIDataCached(): Promise<TradieKPIData> {
    'use cache';
    cacheTag('tradie-management');
    cacheLife(CACHE_PROFILES.MEDIUM);

    return fetchTradieKPIData();
}

/**
 * Toggles the favourite status of a tradie.
 *
 * Updates the `isFavourite` flag for a specific tradie in the database
 * and triggers cache invalidation for related tags.
 *
 * @param {string} tradieId - The unique identifier of the tradie.
 * @param {boolean} isFavourite - The new favourite status to set.
 *
 * @returns {Promise<{ id: string; isFavourite: boolean }>} 
 * An object containing the tradie's ID and updated favourite status.
 *
 * @throws {Error} Throws an error if the update operation fails.
 *
 * @sideEffects
 * - Updates the database via Prisma.
 * - Invalidates cache for:
 *   - `tradie-{tradieId}`
 *   - `tradie-management`
 */
export async function toggleTradieFavourite(tradieId: string, isFavourite: boolean) {
    try {
        const updatedTradie = await prisma.tradie.update({
            where: { id: tradieId },
            data: { isFavourite }
        });

        after(() => {
            cacheTag(`tradie-${tradieId}`);
            cacheTag('tradie-management');
        });

        return {
            id: updatedTradie.id,
            isFavourite: updatedTradie.isFavourite,
        };
    } catch (error) {
        console.error("Error toggling tradie favourite status:", error);
        throw new Error("Failed to toggle tradie favourite status");
    }
}