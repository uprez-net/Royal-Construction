"use server";
import type {
  CreateTradieInput,
  DeleteInput,
  RatingInput,
  ReportIncidentInput,
  TradieDetails,
  TradieRow,
  TradiesByCategory,
  TradieTableQuery,
  UpdatePriceInput,
} from "@/types/tradie";
import prisma from "../prisma";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { TradieIncident, Prisma, Tradie } from "@prisma/client";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { after } from "next/server";
import { DataPoint } from "@/components/common/metric-card";
import { startOfMonth, subMonths } from "date-fns";
import { calculateTrend, dateFormat } from "@/utils/formatters";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { getAllAdminUsersIds } from "./user";
import {
  createTradie as createTradieDomain,
  rateTradie as rateTradieDomain,
  requestTradiePriceChange,
  requestTradieRemoval,
  toggleTradieFavourite as toggleTradieFavouriteDomain,
  updateTradie as updateTradieDomain,
} from "@/lib/domain/tradies/directory";
import { reportTradieIncident as reportTradieIncidentDomain } from "@/lib/domain/tradies/incidents";
import { userPrincipal } from "@/lib/domain/principal";
import { getTradieRemovalImpact } from "@/lib/domain/tradies/queries";
import { tradieTrades } from "@/lib/domain/tradies/request-rules";
import { tradeLabelsMatching } from "@/lib/domain/tradies/trade-types";
import { domainActionFailure } from "@/lib/http/domain-response";

export async function fetchTradieRemovalImpact(tradieId: string) {
  try {
    const actor = await requireTradieActor();
    const impact = await getTradieRemovalImpact(
      userPrincipal(actor),
      tradieId,
      prisma,
    );
    return { ok: true as const, ...impact };
  } catch (error) {
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

/**
 * The signed-in user behind a tradie Server Action.
 *
 * This module is "use server", so every export below is a POST endpoint that
 * any signed-in caller can invoke with arguments of their choosing — and the
 * Redux slice calls several of them straight from the browser, so the
 * directive cannot simply be dropped the way it was for lib/data/user.ts.
 *
 * None of these checked their caller at all until issue #301 phase 6: a
 * CUSTOMER account could POST createTradie, updateTradie, deleteTradie,
 * rateTradie or updateTradiePrice. The rules live in
 * lib/domain/tradies/directory.ts, shared with Eve's tools, and this resolves
 * the caller to hand them.
 */
async function requireTradieActor() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

/**
 * Creates a new tradie record and returns a mapped tradie row.
 *
 * @param input - Tradie creation payload.
 * @returns Newly created tradie formatted for table display.
 * @throws Error if the tradie cannot be created.
 */
export async function createTradie(
  input: CreateTradieInput,
): Promise<TradieRow> {
  try {
    const actor = await requireTradieActor();
    const res = await createTradieDomain(
      userPrincipal(actor),
      input as never,
      prisma,
    );

    after(() => {
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
      revalidateTag(`tradie-${res.id}`, CACHE_PROFILES.MEDIUM);
    });

    return {
      id: res.id,
      name: res.name,
      trade: res.trade,
      trades: tradieTrades(res),
      isFavourite: res.isFavourite,
      lastQuotedPrice: res.lastQuotedPrice
        ? res.lastQuotedPrice.toString()
        : null,
      lastQuotedPriceUnit: res.lastQuotedPriceUnit,
      rating: res.rating ? res.rating.toString() : null,
      jobsCompleted: 0,
      incidentCount: {
        open: 0,
        resolved: 0,
      },
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
export async function getTradieById(
  tradieId: string,
): Promise<TradieDetails | null> {
  try {
    const tradie = await prisma.tradie.findUnique({
      where: { id: tradieId },
      include: {
        ratings: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        incidents: true,
        schedules: {
          select: {
            id: true,
            status: true,
          },
          where: {
            status: "COMPLETED",
          },
        },
      },
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
      reviews: ratings.map((r) => ({
        ...r,
        rating: r.rating.toString(),
        user: {
          id: r.user.id,
          name: r.user.name,
        },
      })),
      incidents: tradie.incidents,
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
export async function getTradieByIdCached(
  tradieId: string,
): Promise<TradieDetails | null> {
  "use cache";
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
    const actor = await requireTradieActor();
    const requested = await requestTradiePriceChange(
      userPrincipal(actor),
      {
        amount: input.newHourlyRate,
        reason: input.reason,
        tradieId: input.tradieId,
        unit: input.newPriceUnit,
      },
      prisma,
    );
    const approval = { id: requested.approvalId };
    const tradie = {
      lastQuotedPrice: requested.previousPrice,
      name: requested.tradieName,
      trade: requested.tradieTrade,
    };

    after(async () => {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
      const notificationPayload = createNotification("tradiePriceUpdate", {
        approvalId: approval.id,
        tradieId: input.tradieId,
        tradieName: tradie.name,
        trade: tradie.trade,
        newPrice: input.newHourlyRate,
        oldPrice: parseFloat((tradie.lastQuotedPrice ?? 0).toString()),
        priceChangeDate: dateFormat.format(new Date()),
      });

      await triggerNotification(
        await getAllAdminUsersIds(),
        notificationPayload,
      );
    });
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
    const user = await requireTradieActor();
    const requested = await requestTradieRemoval(
      userPrincipal(user),
      { reason: input.reason, tradieId: input.tradieId },
      prisma,
    );
    const approval = { id: requested.approvalId };
    const tradie = {
      email: requested.tradieEmail,
      name: requested.tradieName,
      phone: requested.tradiePhone,
      trade: requested.tradieTrade,
    };

    after(async () => {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
      const notificationPayload = createNotification("deleteTradieApproval", {
        approvalId: approval.id,
        tradieId: input.tradieId,
        tradieName: tradie.name,
        trade: tradie.trade,
        tradieEmail: tradie.email,
        tradiePhone: tradie.phone,
        requestedBy: user.name,
      });
      await triggerNotification(
        await getAllAdminUsersIds(),
        notificationPayload,
      );
    });
  } catch (error) {
    console.error("Error deleting tradie:", error);
    const failure = domainActionFailure(error);
    if (failure) return failure;
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
    const user = await requireTradieActor();
    const rated = await rateTradieDomain(
      userPrincipal(user),
      {
        comment: input.comment,
        rating: input.rating,
        tradieId: input.tradieId,
      },
      prisma,
    );
    const tradie = { id: rated.tradieId, name: rated.tradieName };
    const avgRating = { _avg: { rating: rated.average } };

    after(() => {
      revalidateTag(`tradie-${input.tradieId}`, CACHE_PROFILES.MEDIUM);
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
    });

    return {
      id: tradie.id,
      newRating: (avgRating._avg.rating ?? 0).toString(),
    };
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
export async function reportTradieIncident(
  input: ReportIncidentInput,
): Promise<TradieIncident> {
  try {
    const user = await requireTradieActor();
    // The incident, its evidence and the approval request are one decision,
    // and the file rules are the ones this path already hardened: only the
    // reporter's own, unattached files, or the whole report fails. Eve's copy
    // matched on uploadedBy alone and could move a project's file onto an
    // incident, which cascades. lib/domain/tradies/incidents.ts now owns it.
    const reported = await reportTradieIncidentDomain(
      userPrincipal(user),
      {
        description: input.incidentDescription,
        fileIds: input.fileIds,
        incidentType: input.incidentType,
        severity: input.incidentSeverity,
        tradieId: input.tradieId,
      },
      prisma,
    );
    const incident = reported.incident;
    const approval = { id: reported.approvalId };
    const tradie = { name: reported.tradieName, trade: reported.tradieTrade };

    after(async () => {
      revalidateTag(`tradie-${input.tradieId}`, CACHE_PROFILES.MEDIUM);
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);

      const notificationPayload = createNotification("tradieIncidentReport", {
        approvalId: approval.id,
        incidentId: incident.id,
        tradieId: input.tradieId,
        tradieName: tradie.name,
        trade: tradie.trade,
        incidentDescription: input.incidentDescription,
        incidentDate: new Date().toISOString(),
      });

      await triggerNotification(
        await getAllAdminUsersIds(),
        notificationPayload,
      );
    });

    return incident;
  } catch (error) {
    console.error("Error reporting tradie incident:", error);
    throw new Error("Failed to report tradie incident");
  }
}

/**
 * The category tile a tradie sits under, and the key its filter matches.
 *
 * The label as stored: the trade list is Admin → Trade types, a tradie can
 * only be given a listed label, and a rename carries its tradies with it.
 */
function tradeCategory(trade: string): string {
  return trade.trim() || "Others";
}

/** Every tile a tradie sits under: each trade, or "Others" with none. */
function tradeCategories(tradie: {
  trade: string;
  trades?: string[] | null;
}): string[] {
  const categories = tradieTrades(tradie).map(tradeCategory);
  return categories.length > 0 ? categories : ["Others"];
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

export async function getTradieGroupedByCategory(): Promise<
  TradiesByCategory[]
> {
  try {
    const tradies = await prisma.tradie.findMany({
      where: { archivedAt: null },
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
        trades: tradieTrades(tradie),
        isFavourite: tradie.isFavourite,
        lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
        lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
        rating: tradie.rating?.toString() ?? null,

        jobsCompleted: tradie.schedules.filter((s) => s.status === "COMPLETED")
          .length,

        incidentCount: {
          open: tradie.incidents.filter((i) => i.status === "OPEN").length,

          resolved: tradie.incidents.filter((i) => i.status === "RESOLVED")
            .length,
        },
      };

      // Under every category they work in, so a plumber who also does gas
      // is offered for gas work too.
      for (const category of tradeCategories(tradie)) {
        const existing = grouped.get(category);
        if (existing) {
          existing.push(row);
        } else {
          grouped.set(category, [row]);
        }
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
                    ratings.reduce((sum, rating) => sum + rating, 0)
                    / ratings.length
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

export async function getTradieGroupedByCategoryCached(): Promise<
  TradiesByCategory[]
> {
  "use cache";
  cacheTag("tradie-management");
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
export async function fetchFilteredTradies(
  input: TradieTableQuery,
): Promise<TradieRow[]> {
  try {
    // "gas" finds a tradie whose second trade is Gas Fitting.
    const tradeLabels = input.search
      ? await tradeLabelsMatching(input.search, prisma)
      : [];
    const whereClause: Prisma.TradieWhereInput = {
      archivedAt: null,
      ...(input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" } },
              { trade: { contains: input.search, mode: "insensitive" } },
              ...(tradeLabels.length > 0
                ? [{ trades: { hasSome: tradeLabels } }]
                : []),
              { abn: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : undefined),
      ...(input.rating ? { rating: { gte: input.rating } } : undefined),
      ...(input.favourite !== undefined
        ? { isFavourite: input.favourite }
        : undefined),
      ...(input.tab === "flagged"
        ? { incidents: { some: { status: "OPEN" } } }
        : undefined),
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

    // The category is matched here rather than in the query so it is the
    // same key the tiles group by, blank and untrimmed trades included. This
    // listing is not paginated, so nothing is lost by filtering after.
    const inCategory = input.category
      ? tradies.filter((tradie) =>
          tradeCategories(tradie).includes(input.category!),
        )
      : tradies;

    return inCategory.map((tradie) => {
      return {
        ...tradie,
        trades: tradieTrades(tradie),
        lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
        lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
        rating: tradie.rating?.toString() ?? null,
        jobsCompleted: tradie.schedules.filter((s) => s.status === "COMPLETED")
          .length,
        incidentCount: {
          open: tradie.incidents.filter((i) => i.status === "OPEN").length,
          resolved: tradie.incidents.filter((i) => i.status === "RESOLVED")
            .length,
        },
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
                    WHERE "archivedAt" IS NULL
                ) AS registered_tradies,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "archivedAt" IS NULL AND "createdAt" >= ${currentMonthStart}
                ) AS registered_current_month,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "archivedAt" IS NULL AND "createdAt" >= ${previousMonthStart}
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
                    WHERE "archivedAt" IS NULL AND "isFavourite" = true
                ) AS favourite_tradies,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "archivedAt" IS NULL AND "isFavourite" = true
                    AND "createdAt" >= ${currentMonthStart}
                ) AS favourites_current_month,

                (
                    SELECT COUNT(*)
                    FROM "Tradie"
                    WHERE "archivedAt" IS NULL AND "isFavourite" = true
                    AND "createdAt" >= ${previousMonthStart}
                    AND "createdAt" < ${currentMonthStart}
                ) AS favourites_previous_month
        `;

    return {
      registeredTradies: calculateTrend(
        Number(result.registered_tradies),
        Number(result.registered_previous_month),
      ),

      incidentLodged: calculateTrend(
        Number(result.incidents_lodged),
        Number(result.incidents_previous_month),
      ),

      favouriteTradies: calculateTrend(
        Number(result.favourite_tradies),
        Number(result.favourites_previous_month),
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
  "use cache";
  cacheTag("tradie-management");
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
export async function toggleTradieFavourite(
  tradieId: string,
  isFavourite: boolean,
) {
  try {
    const actor = await requireTradieActor();
    const updatedTradie = await toggleTradieFavouriteDomain(
      userPrincipal(actor),
      tradieId,
      isFavourite,
      prisma,
    );

    after(() => {
      revalidateTag(`tradie-${tradieId}`, CACHE_PROFILES.MEDIUM);
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
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
      where: { archivedAt: null },
      include: {
        schedules: {
          select: {
            id: true,
            status: true,
          },
        },
        incidents: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    return tradies.map(({ schedules, incidents, ...tradie }) => ({
      ...tradie,
      lastQuotedPrice: tradie.lastQuotedPrice?.toString() ?? null,
      lastQuotedPriceUnit: tradie.lastQuotedPriceUnit,
      rating: tradie.rating?.toString() ?? null,
      scheduledJobs: schedules.filter((s) =>
        ["CONFIRMED", "PENDING"].includes(s.status),
      ).length,
      jobsCompleted: schedules.filter((s) => s.status === "COMPLETED").length,
      openIncidents: incidents.filter((i) => i.status === "OPEN").length,
    }));
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
export async function updateTradie(
  tradieId: string,
  data: Partial<
    Pick<
      Tradie,
      | "name"
      | "email"
      | "abn"
      | "additionalEmails"
      | "phone"
      | "location"
      | "note"
      | "trades"
    >
  >,
): Promise<TradieDetails> {
  try {
    const actor = await requireTradieActor();
    // The write and its ADMIN guard are the domain's; the rich shape below is
    // this screen's, so it is re-read rather than pushed into the rule.
    await updateTradieDomain(userPrincipal(actor), tradieId, data, prisma);
    const updatedTradie = await prisma.tradie.findUniqueOrThrow({
      where: { id: tradieId },
      include: {
        ratings: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        incidents: true,
        schedules: {
          select: {
            id: true,
            status: true,
          },
          where: {
            status: "COMPLETED",
          },
        },
      },
    });

    after(() => {
      revalidateTag(`tradie-${tradieId}`, CACHE_PROFILES.MEDIUM);
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
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
      reviews: ratings.map((r) => ({
        ...r,
        rating: r.rating.toString(),
        user: {
          id: r.user.id,
          name: r.user.name,
        },
      })),
      incidents: updatedTradie.incidents,
    };
  } catch (error) {
    console.error("Error updating tradie:", error);
    throw new Error("Failed to update tradie");
  }
}
