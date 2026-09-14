'use server';
import type {
    CreateTradieInput,
    DeleteInput,
    IncidentReportJsonPayload,
    PriceUpdateJsonPayload,
    RatingInput,
    ReportIncidentInput,
    TradieDetails,
    TradieRow,
    TradiesByCategory,
    TradieTableQuery,
    UpdatePriceInput
} from "@/types/tradie";
import prisma from "../prisma";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { TradieApprovalActionType, TradieIncident, Prisma, Tradie } from "@prisma/client";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { after } from "next/server"
import { DataPoint } from "@/components/common/metric-card";
import { startOfMonth, subMonths } from "date-fns";
import { calculateTrend, dateFormat } from "@/utils/formatters";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { convertCategoryToTradieType } from "@/utils/normalize-tradie-type";
import { getAllAdminUsersIds } from "./user";

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

        after(() => {
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
            revalidateTag(`tradie-${res.id}`, CACHE_PROFILES.MEDIUM);
        });

        return {
            id: res.id,
            name: res.name,
            trade: res.trade,
            isFavourite: res.isFavourite,
            lastQuotedPrice: res.lastQuotedPrice ? res.lastQuotedPrice.toString() : null,
            lastQuotedPriceUnit: res.lastQuotedPriceUnit,
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

        // `ratings` and `schedules` are destructured OFF the returned object, not
        // just replaced. `...tradie` used to spread them through: `hourlyRate` and
        // `rating` were safely overwritten because the key names match, but
        // `ratings` -> `reviews` is a *rename*, so the raw Prisma rows survived
        // underneath the mapped copy. Those rows carry `rating: Decimal`, and a
        // Prisma Decimal is not serializable across the RSC boundary — React threw
        // "Only plain objects can be passed to Client Components" on every visit to
        // the tradie detail page.
        //
        // Dropping them also cuts the payload: neither is read anywhere on the
        // client (verified across components/), so both were dead weight embedded
        // in the HTML response and every subsequent RSC request.
        const { ratings, schedules, ...tradieFields } = tradie;

        return {
            ...tradieFields,
            lastQuotedPrice: tradie.lastQuotedPrice?.toString(),
            lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
            rating: tradie.rating?.toString(),
            jobsCompleted: schedules.length,
            reviews: ratings.map(r => ({
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
                requestedBy: user.id,
                updationData: {
                    newHourlyRate: input.newHourlyRate,
                    newPriceUnit: input.newPriceUnit,
                } satisfies PriceUpdateJsonPayload
            },
            select: {
                id: true
            }
        })

        after(async () => {
            revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
            revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
            const notificationPayload = createNotification('tradiePriceUpdate', {
                approvalId: approval.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                newPrice: input.newHourlyRate,
                oldPrice: parseFloat((tradie.lastQuotedPrice ?? 0).toString()),
                priceChangeDate: dateFormat.format(new Date()),
            });

            await triggerNotification(await getAllAdminUsersIds(), notificationPayload);
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
        const approval = await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.TRADIE_REMOVAL,
                reason: input.reason,
                requestedBy: user.id,
            },
            select: {
                id: true
            }
        })

        after(async () => {
            revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
            revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
            const notificationPayload = createNotification('deleteTradieApproval', {
                approvalId: approval.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                tradieEmail: tradie.email,
                tradiePhone: tradie.phone,
                requestedBy: user.name,
            });
            await triggerNotification(await getAllAdminUsersIds(), notificationPayload);
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
            revalidateTag(`tradie-${input.tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
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

        const fileIds = [...new Set(input.fileIds ?? [])];
        const { incident, approval } = await prisma.$transaction(async (tx) => {
            const incident = await tx.tradieIncident.create({
                data: {
                    tradieId: input.tradieId,
                    type: input.incidentType,
                    severity: input.incidentSeverity,
                    description: input.incidentDescription,
                },
            });

            // The file ids come from the browser. `connect` took any id, which
            // moved another record's file onto this incident, and File.incidentId
            // cascades, so deleting the incident deleted that file. Attach only
            // what the report modal uploads: the reporter's own files, not yet
            // on a project, milestone, lead, compliance document or incident.
            if (fileIds.length > 0) {
                const attached = await tx.file.updateMany({
                    where: {
                        id: { in: fileIds },
                        uploadedBy: user.id,
                        projectId: null,
                        milestoneId: null,
                        leadId: null,
                        complianceDocumentId: null,
                        incidentId: null,
                    },
                    data: { incidentId: incident.id },
                });
                // Fail the report as a missing id did under `connect`, rather
                // than file it without evidence the reporter attached.
                if (attached.count !== fileIds.length) {
                    throw new Error("Incident files are missing or belong to another record");
                }
            }

            const approval = await tx.tradieApproval.create({
                data: {
                    tradieId: input.tradieId,
                    actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
                    reason: input.incidentDescription,
                    requestedBy: user.id,
                    updationData: {
                        incidentId: incident.id,
                        incidentType: input.incidentType,
                        incidentSeverity: input.incidentSeverity,
                        incidentDescription: input.incidentDescription,
                    } satisfies IncidentReportJsonPayload,
                },
            });

            return { incident, approval };
        });

        after(async () => {
            revalidateTag(`tradie-${input.tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
            revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
            revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);

            const notificationPayload = createNotification('tradieIncidentReport', {
                approvalId: approval.id,
                incidentId: incident.id,
                tradieId: input.tradieId,
                tradieName: tradie.name,
                trade: tradie.trade,
                incidentDescription: input.incidentDescription,
                incidentDate: new Date().toISOString(),
            });

            await triggerNotification(await getAllAdminUsersIds(), notificationPayload);
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
                lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
            lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
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

            const existing = grouped.get(convertCategoryToTradieType(tradie.trade) ?? "Others");

            if (existing) {
                existing.push(row);
            } else {
                grouped.set(convertCategoryToTradieType(tradie.trade) ?? "Others", [row]);
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
                lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
            lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
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
            revalidateTag(`tradie-${tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
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

/**
 * Exports all tradies with aggregated job and incident statistics.
 *
 * Retrieves tradies along with their schedules and incidents, then
 * transforms the data into an export-friendly format by:
 * - Converting `hourlyRate` and `rating` decimals to strings.
 * - Calculating the number of scheduled jobs (`CONFIRMED` and `PENDING`).
 * - Calculating the number of completed jobs (`COMPLETED`).
 * - Calculating the number of open incidents (`OPEN`).
 *
 * @returns A list of tradies enriched with computed metrics:
 * - `scheduledJobs`
 * - `jobsCompleted`
 * - `openIncidents`
 *
 * @throws {Error} If the tradie export operation fails.
 */
export async function exportTradies() {
    try {
        const tradies = await prisma.tradie.findMany({
            include: {
                schedules: {
                    select: {
                        id: true,
                        status: true,
                    }
                },
                incidents: {
                    select: {
                        id: true,
                        status: true,
                    }
                }
            }
        });

        return tradies.map(({ schedules, incidents, ...tradie }) => ({
            ...tradie,
            lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
            lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
            rating: tradie.rating?.toString() ?? null,
            scheduledJobs: schedules.filter(s => ["CONFIRMED", "PENDING"].includes(s.status)).length,
            jobsCompleted: schedules.filter(s => s.status === "COMPLETED").length,
            openIncidents: incidents.filter(i => i.status === "OPEN").length,
        }))
    } catch (error) {
        console.error("Error exporting tradies:", error);
        throw new Error("Failed to export tradies");
    }
}

/**
 * Updates a tradie's editable contact information and returns the formatted tradie row data.
 *
 * Updates the specified tradie record with the provided fields, including email,
 * phone, or location. The updated tradie is fetched with related ratings, incidents,
 * and completed schedules to calculate additional display metrics.
 *
 * After a successful update, invalidates the tradie-specific cache and the
 * tradie management cache to ensure fresh data is served.
 *
 * @param tradieId - The unique identifier of the tradie to update.
 * @param data - Partial tradie data containing the fields to update.
 * Supports updating email, phone, and location.
 *
 * @returns A promise resolving to a formatted `TradieRow` containing:
 * - Updated tradie details.
 * - Serialized decimal fields (`hourlyRate`, `rating`).
 * - Number of completed jobs.
 * - Incident counts grouped by status.
 *
 * @throws Throws an error if the tradie update operation fails.
 */
export async function updateTradie(tradieId: string, data: Partial<Pick<Tradie, 'email' | 'abn' | 'additionalEmails' | 'phone' | 'location' | 'note'>>): Promise<TradieDetails> {
    try {
        const updatedTradie = await prisma.tradie.update({
            where: { id: tradieId },
            data,
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

        after(() => {
            revalidateTag(`tradie-${tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
        });

        // Same Decimal-leak fix as getTradieById: drop `ratings`/`schedules` rather
        // than letting `...updatedTradie` spread the raw Prisma rows through beside
        // the mapped `reviews`. This return value goes straight back to the client
        // after an edit, so the unserializable Decimal would surface there too.
        const { ratings, schedules, ...tradieFields } = updatedTradie;

        return {
            ...tradieFields,
            lastQuotedPrice: updatedTradie.lastQuotedPrice?.toString(),
            rating: updatedTradie.rating?.toString(),
            jobsCompleted: schedules.length,
            reviews: ratings.map(r => ({
                ...r,
                rating: r.rating.toString(),
                user: {
                    id: r.user.id,
                    name: r.user.name
                }
            })),
            incidents: updatedTradie.incidents
        };
    } catch (error) {
        console.error("Error updating tradie:", error);
        throw new Error("Failed to update tradie");
    }
}