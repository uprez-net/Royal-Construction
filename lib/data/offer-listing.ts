import { Prisma } from "@prisma/client";
import { cacheLife, cacheTag } from "next/cache";
import { startOfWeek, subWeeks } from "date-fns";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import type {
    KPIResult,
    OfferGroup,
    OfferKPIs,
    OfferStatusBucket,
    PaginatedOfferGroupResult,
} from "@/types/offer";
import { calculateTrend } from "@/utils/formatters";
import type { LeadListScope } from "@/lib/offer/access";
import { offerSearchClauses, toOfferListRow } from "@/lib/offer/offer-listing-query";
import { OFFER_STATUS_BUCKETS } from "@/lib/offer/offer-status-buckets";

// The offers listing's queries. Deliberately not a "use server" module: every
// function here takes the caller's lead scope as an argument, and exporting one
// as a Server Action would let the browser pick its own scope. The browser
// reaches these only through getOfferGroups in lib/data/offers.ts, which
// derives the scope from the session.

/**
 * The scope as a join for the raw queries, which cannot reuse a Prisma where.
 * Every raw read of "Offer" goes through this one fragment, aliased `o`, so the
 * KPI cards, the tab filter and the table agree on which leads a user sees.
 */
function scopedOfferJoin(scope: LeadListScope): Prisma.Sql {
    return scope.assignedId === null
        ? Prisma.empty
        : Prisma.sql`JOIN "Lead" l ON l."id" = o."leadId" AND l."assignedId" = ${scope.assignedId}`;
}

// Arguments can arrive from the browser through getOfferGroups, so nothing
// here assumes they have the declared types.
function offerListPaging(page?: number, limit?: number) {
    return {
        page: Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1,
        limit: Number.isFinite(limit) && (limit ?? 12) > 0 ? Math.min(Math.floor(limit ?? 12), 100) : 12,
    };
}

export function emptyOfferGroupResult(page?: number, limit?: number): PaginatedOfferGroupResult {
    return {
        items: [],
        ...offerListPaging(page, limit),
        totalCount: 0,
        totalOfferCount: 0,
        totalPages: 1,
    };
}

export function emptyOfferKPIs(): OfferKPIs {
    return {
        totalVersions: 0,
        allOffers: { total: 0, trendDelta: 0 },
        pendingOffers: { total: 0, trendDelta: 0 },
        approvedOffers: { total: 0, trendDelta: 0 },
        rejectedOffers: { total: 0, trendDelta: 0 },
        sentOffers: { total: 0, trendDelta: 0 },
    };
}

/**
 * Offer listing, grouped into one row per lead.
 *
 * A lead accumulates one `Offer` row per revision, so a flat listing showed the
 * same client three or four times over. Pagination therefore runs over leads
 * (the unit the table renders) and every revision for the leads on the page is
 * fetched alongside them, which is what the expandable version history reads.
 *
 * Status filtering is over the *representative* revision (active else highest
 * revision number), the same selection rule `queryOfferKPIs` uses, so a lead is
 * counted and filtered in the bucket of the revision that is actually live.
 */
export async function queryOfferGroups(
    page: number | undefined,
    limit: number | undefined,
    q: string | undefined,
    status: OfferStatusBucket | undefined,
    scope: LeadListScope,
): Promise<PaginatedOfferGroupResult> {
    const { page: safePage, limit: safeLimit } = offerListPaging(page, limit);
    const safeQuery = typeof q === "string" && q.trim() !== "" ? q.trim() : undefined;
    const bucketStatuses =
        status && status !== "all" && Object.hasOwn(OFFER_STATUS_BUCKETS, status)
            ? OFFER_STATUS_BUCKETS[status]
            : null;
    try {
        // Leads whose representative revision lands in the selected status
        // bucket. Computed up front with the same DISTINCT ON rule the KPIs use,
        // so the filter and the KPI cards agree on which revision speaks for a
        // lead. An empty result set is meaningful ("no leads in this bucket"),
        // so `id IN ([])` correctly yields no rows.
        let leadIdsInBucket: number[] | null = null;
        if (bucketStatuses) {
            const rows = await prisma.$queryRaw<{ leadId: number }[]>`
                WITH representative AS (
                    SELECT DISTINCT ON (o."leadId") o."leadId", o."offerStatus"
                    FROM "Offer" o
                    ${scopedOfferJoin(scope)}
                    ORDER BY o."leadId", o."isActive" DESC, o."revisionNumber" DESC, o."createdAt" DESC
                )
                SELECT "leadId" FROM representative
                WHERE "offerStatus" IN (${Prisma.join(bucketStatuses)})
            `;
            leadIdsInBucket = rows.map((row) => row.leadId);
        }

        // `some: {}` keeps out leads that have never been offered on. The search
        // terms are OR'd: nesting them in one object (as the flat query did)
        // AND's them, so a name match only counted when the email, phone and
        // location all matched the same string too.
        const leadWhere: Prisma.LeadWhereInput = {
            offers: { some: {} },
            ...(scope.assignedId !== null ? { assignedId: scope.assignedId } : {}),
            ...(leadIdsInBucket !== null ? { id: { in: leadIdsInBucket } } : {}),
            ...(safeQuery ? { OR: offerSearchClauses(safeQuery) } : {}),
        };

        const [leads, totalCount, totalOfferCount] = await Promise.all([
            prisma.lead.findMany({
                where: leadWhere,
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    location: true,
                    type: true,
                    offers: {
                        orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
                        select: {
                            id: true,
                            leadId: true,
                            baseReference: true,
                            revisionNumber: true,
                            isActive: true,
                            offerStatus: true,
                            amount: true,
                            gstAmount: true,
                            totalAmount: true,
                            contractValueIncGst: true,
                            sentAt: true,
                            acceptedAt: true,
                            createdAt: true,
                            updatedAt: true,
                            // Read only to price unpriced rows; toOfferListRow drops it.
                            workspaceState: true,
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

        const items = leads.flatMap<OfferGroup>(({ offers, ...lead }) => {
            const revisions = offers.map(({ offerFiles, ...offer }) =>
                toOfferListRow(offer, offerFiles[0]?.version ?? 1),
            );

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
        return emptyOfferGroupResult(safePage, safeLimit);
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
export async function queryOfferKPIs(scope: LeadListScope): Promise<OfferKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, {
            weekStartsOn: 1,
        });

        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const pending = Prisma.join(OFFER_STATUS_BUCKETS.pending);
        const approved = Prisma.join(OFFER_STATUS_BUCKETS.approved);
        const rejected = Prisma.join(OFFER_STATUS_BUCKETS.rejected);
        const sent = Prisma.join(OFFER_STATUS_BUCKETS.sent);

        const [result] = await prisma.$queryRaw<OfferKPIQueryResult[]>`
            WITH representative AS (
                SELECT DISTINCT ON (o."leadId") o.*
                FROM "Offer" o
                ${scopedOfferJoin(scope)}
                ORDER BY o."leadId", o."isActive" DESC, o."revisionNumber" DESC, o."createdAt" DESC
            )
            SELECT
                (SELECT COUNT(*) FROM "Offer" o ${scopedOfferJoin(scope)}) AS total_versions,

                COUNT(*) AS all_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${pending})
                ) AS pending_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${approved})
                ) AS approved_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${rejected})
                ) AS rejected_offers,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${sent})
                ) AS sent_offers,

                COUNT(*) FILTER (
                    WHERE "createdAt" >= ${previousWeekStart}
                    AND "createdAt" < ${currentWeekStart}
                ) AS all_previous_week,

                COUNT(*) FILTER (
                    WHERE "createdAt" >= ${currentWeekStart}
                ) AS all_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${pending})
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS pending_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${pending})
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS pending_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${approved})
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS approved_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${approved})
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS approved_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${rejected})
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS rejected_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${rejected})
                    AND "updatedAt" >= ${currentWeekStart}
                ) AS rejected_current_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${sent})
                    AND "updatedAt" >= ${previousWeekStart}
                    AND "updatedAt" < ${currentWeekStart}
                ) AS sent_previous_week,

                COUNT(*) FILTER (
                    WHERE "offerStatus" IN (${sent})
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

        return emptyOfferKPIs();
    }
}

// `scope` is an argument, not something read inside: a "use cache" scope cannot
// call auth(), and as an argument it is part of the cache key, so each scope
// gets its own entry. Callers resolve it from the session first.
export const getOfferGroupsCached = async (
    page: number | undefined,
    limit: number | undefined,
    q: string | undefined,
    status: OfferStatusBucket | undefined,
    scope: LeadListScope,
) => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return queryOfferGroups(page, limit, q, status, scope);
}

export const getOfferKPIsCached = async (scope: LeadListScope) => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return queryOfferKPIs(scope);
}
