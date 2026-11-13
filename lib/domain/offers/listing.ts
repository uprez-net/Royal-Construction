import { Prisma } from "@prisma/client";
import { startOfWeek, subWeeks } from "date-fns";

import type { DomainDb } from "../db";
import { leadListOrderBy } from "../leads/list-sort";
import { readLeadListSort, type LeadListSort } from "@/lib/leads/list-sort";
import type { LeadListScope } from "../access/leads";
import {
  offerListLeadWhere,
  toOfferListRow,
} from "@/lib/offer/offer-listing-query";
import { OFFER_STATUS_BUCKETS } from "@/lib/offer/offer-status-buckets";
import type {
  KPIResult,
  OfferGroup,
  OfferKPIs,
  OfferStatusBucket,
  PaginatedOfferGroupResult,
} from "@/types/offer";
import { calculateTrend } from "@/utils/formatters";

function scopedOfferJoin(scope: LeadListScope): Prisma.Sql {
  return scope.assignedId === null
    ? Prisma.empty
    : Prisma.sql`JOIN "Lead" l ON l."id" = o."leadId" AND l."assignedId" = ${scope.assignedId}`;
}

function offerListPaging(page?: number, limit?: number) {
  return {
    page: Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1,
    limit:
      Number.isFinite(limit) && (limit ?? 12) > 0
        ? Math.min(Math.floor(limit ?? 12), 100)
        : 12,
  };
}

export function emptyOfferGroupResult(
  page?: number,
  limit?: number,
): PaginatedOfferGroupResult {
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
    allOffers: { total: 0, trendDelta: 0 },
    openOffers: 0,
    approvedOffers: { total: 0, trendDelta: 0 },
    pendingOffers: { total: 0, trendDelta: 0 },
    rejectedOffers: { total: 0, trendDelta: 0 },
    sentOffers: { total: 0, trendDelta: 0 },
    totalVersions: 0,
  };
}

/** One row per lead, represented by its active revision or newest fallback. */
export async function queryOfferGroups(
  db: DomainDb,
  page: number | undefined,
  limit: number | undefined,
  q: string | undefined,
  status: OfferStatusBucket | undefined,
  scope: LeadListScope,
  sort: LeadListSort = "updatedAt-desc",
): Promise<PaginatedOfferGroupResult> {
  const { page: safePage, limit: safeLimit } = offerListPaging(page, limit);
  const bucketStatuses =
    status && status !== "all" && Object.hasOwn(OFFER_STATUS_BUCKETS, status)
      ? OFFER_STATUS_BUCKETS[status]
      : null;
  // "All" is every offer still in play: a rejected one stays on the Rejected
  // tab and is not mixed into the working list (issue #450). Expressed against
  // the same representative revision as the buckets, so a lead whose newest
  // revision was rejected is out and one re-priced after a rejection is in.
  const bucketFilter = bucketStatuses
    ? Prisma.sql`"offerStatus" IN (${Prisma.join(bucketStatuses)})`
    : Prisma.sql`"offerStatus" NOT IN (${Prisma.join(OFFER_STATUS_BUCKETS.rejected)})`;
  const rows = await db.$queryRaw<{ leadId: number }[]>`
    WITH representative AS (
      SELECT DISTINCT ON (o."leadId") o."leadId", o."offerStatus"
      FROM "Offer" o
      ${scopedOfferJoin(scope)}
      ORDER BY o."leadId", o."isActive" DESC, o."revisionNumber" DESC, o."createdAt" DESC
    )
    SELECT "leadId" FROM representative
    WHERE ${bucketFilter}
  `;
  const leadIdsInBucket = rows.map((row) => row.leadId);

  const leadWhere = offerListLeadWhere(scope, leadIdsInBucket, q);
  const [leads, totalCount, totalOfferCount] = await Promise.all([
    db.lead.findMany({
      orderBy: leadListOrderBy(readLeadListSort(sort, "updatedAt-desc")),
      select: {
        email: true,
        id: true,
        location: true,
        name: true,
        offers: {
          orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
          select: {
            acceptedAt: true,
            amount: true,
            baseReference: true,
            contractValueIncGst: true,
            createdAt: true,
            gstAmount: true,
            id: true,
            isActive: true,
            leadId: true,
            offerFiles: {
              orderBy: { version: "desc" },
              select: { version: true },
              take: 1,
            },
            offerStatus: true,
            revisionNumber: true,
            sentAt: true,
            totalAmount: true,
            updatedAt: true,
            workspaceState: true,
          },
        },
        phone: true,
        type: true,
      },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      where: leadWhere,
    }),
    db.lead.count({ where: leadWhere }),
    db.offer.count({ where: { lead: leadWhere } }),
  ]);
  const items = leads.flatMap<OfferGroup>(({ offers, ...lead }) => {
    const revisions = offers.map(({ offerFiles, ...offer }) =>
      toOfferListRow(offer, offerFiles[0]?.version ?? 1),
    );
    const latest =
      revisions.find((revision) => revision.isActive) ?? revisions[0];
    return latest
      ? [
          {
            latest,
            lead,
            leadId: lead.id,
            reference: latest.baseReference || `OF-${lead.id}`,
            revisions,
            versionCount: revisions.length,
          },
        ]
      : [];
  });
  return {
    items,
    limit: safeLimit,
    page: safePage,
    totalCount,
    totalOfferCount,
    totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
  };
}

type OfferKPIQueryResult = {
  total_versions: bigint;
  all_offers: bigint;
  open_offers: bigint;
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

function offerKPI(total: bigint, current: bigint, previous: bigint): KPIResult {
  return {
    total: Number(total),
    trendDelta: calculateTrend(Number(current), Number(previous)).trendDelta,
  };
}

/** KPI cards use the exact representative-revision rule used by the table. */
export async function queryOfferKPIs(
  db: DomainDb,
  scope: LeadListScope,
  now = new Date(),
): Promise<OfferKPIs> {
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const previousWeekStart = subWeeks(currentWeekStart, 1);
  const pending = Prisma.join(OFFER_STATUS_BUCKETS.pending);
  const approved = Prisma.join(OFFER_STATUS_BUCKETS.approved);
  const rejected = Prisma.join(OFFER_STATUS_BUCKETS.rejected);
  const sent = Prisma.join(OFFER_STATUS_BUCKETS.sent);
  const [result] = await db.$queryRaw<OfferKPIQueryResult[]>`
    WITH representative AS (
      SELECT DISTINCT ON (o."leadId") o.* FROM "Offer" o
      ${scopedOfferJoin(scope)}
      ORDER BY o."leadId", o."isActive" DESC, o."revisionNumber" DESC, o."createdAt" DESC
    )
    SELECT
      (SELECT COUNT(*) FROM "Offer" o ${scopedOfferJoin(scope)}) AS total_versions,
      COUNT(*) AS all_offers,
      COUNT(*) FILTER (WHERE "offerStatus" NOT IN (${rejected})) AS open_offers,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${pending})) AS pending_offers,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${approved})) AS approved_offers,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${rejected})) AS rejected_offers,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${sent})) AS sent_offers,
      COUNT(*) FILTER (WHERE "createdAt" >= ${previousWeekStart} AND "createdAt" < ${currentWeekStart}) AS all_previous_week,
      COUNT(*) FILTER (WHERE "createdAt" >= ${currentWeekStart}) AS all_current_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${pending}) AND "updatedAt" >= ${previousWeekStart} AND "updatedAt" < ${currentWeekStart}) AS pending_previous_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${pending}) AND "updatedAt" >= ${currentWeekStart}) AS pending_current_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${approved}) AND "updatedAt" >= ${previousWeekStart} AND "updatedAt" < ${currentWeekStart}) AS approved_previous_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${approved}) AND "updatedAt" >= ${currentWeekStart}) AS approved_current_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${rejected}) AND "updatedAt" >= ${previousWeekStart} AND "updatedAt" < ${currentWeekStart}) AS rejected_previous_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${rejected}) AND "updatedAt" >= ${currentWeekStart}) AS rejected_current_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${sent}) AND "updatedAt" >= ${previousWeekStart} AND "updatedAt" < ${currentWeekStart}) AS sent_previous_week,
      COUNT(*) FILTER (WHERE "offerStatus" IN (${sent}) AND "updatedAt" >= ${currentWeekStart}) AS sent_current_week
    FROM representative
  `;
  if (!result) return emptyOfferKPIs();
  return {
    allOffers: offerKPI(
      result.all_offers,
      result.all_current_week,
      result.all_previous_week,
    ),
    openOffers: Number(result.open_offers),
    approvedOffers: offerKPI(
      result.approved_offers,
      result.approved_current_week,
      result.approved_previous_week,
    ),
    pendingOffers: offerKPI(
      result.pending_offers,
      result.pending_current_week,
      result.pending_previous_week,
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
    totalVersions: Number(result.total_versions),
  };
}
