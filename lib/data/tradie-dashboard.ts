import prisma from "@/lib/prisma";
import { Prisma, TradieScheduleStatus } from "@prisma/client";
import {
  TradieActivityItem,
  TradieCoordinationDashboard,
  TradieCoordinationQuery,
  TradieCoordinationSortBy,
  TradieStatusMetric,
  TradieCoordinationTab,
  TradieScheduleListItem,
} from "@/types/project";
import { differenceInCalendarDays, startOfDay, addDays, startOfWeek } from "date-fns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 10;
const ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// Resolved query shape (internal)
// ---------------------------------------------------------------------------

type ResolvedCoordinationQuery = {
  page: number;
  limit: number;
  search: string;
  projectId: string | null;
  tradeType: string | null;
  status: TradieScheduleStatus | null;
  tab: TradieCoordinationTab;
  sortBy: TradieCoordinationSortBy;
  sortOrder: "asc" | "desc";
};

// ---------------------------------------------------------------------------
// Raw row types returned by $queryRaw
// All Decimal columns come back as string from Prisma raw queries.
// All DateTime columns come back as Date objects.
// ---------------------------------------------------------------------------

type ScheduleRow = {
  id: string;
  tradie_id: string;
  tradie_name: string;
  isFavourite: boolean;
  note: string | null;
  abn: string;
  trade_type: string;
  project_id: string;
  project_name: string;
  site_manager_name: string | null;
  site_manager_email: string | null;
  site_manager_phone: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  scheduled_date: Date;
  duration_days: number;
  status: TradieScheduleStatus;
  hourly_rate: string | null;
  rating: string | null;
  reminder_sent_at: Date | null;
  updated_at: Date;
  tradie_email: string;
  tradie_phone: string;
};

type CountRow = { count: bigint };

type TradeOptionRow = { trade_type: string };

type StatusCountRow = {
  confirmed: bigint;
  pending: bigint;
  pending_response: bigint;
  no_response: bigint;
  declined: bigint;
  completed: bigint;
};

type ActiveTradieRow = { tradie_id: string };

type TradeStatusGroupRow = {
  tradie_id: string;
  status: TradieScheduleStatus;
  cnt: bigint;
};

type ProjectAllocationRow = {
  project_id: string;
  project_name: string;
  allocation_count: bigint;
};

type UtilizationRow = {
  week_start: Date;
  total: bigint;
  confirmed: bigint;
};

type ActivityRow = {
  id: string;
  status: TradieScheduleStatus;
  updated_at: Date;
  tradie_name: string;
  project_name: string;
};

type UrgentRow = {
  id: string;
  tradie_name: string;
  trade_type: string;
  abn: string;
  project_name: string;
  site_manager_name: string | null;
  site_manager_email: string | null;
  site_manager_phone: string | null;
  milestone_name: string | null;
  scheduled_date: Date;
  status: TradieScheduleStatus;
  reminder_sent_at: Date | null;
  tradie_email: string;
  tradie_phone: string;
  hourly_rate: string | null;
  rating: string | null;
};

type TradeTypeRow = { id: string; trade_type: string };

type TabCountRow = {
  tab_all: bigint;
  tab_week: bigint;
  tab_confirmed: bigint;
  tab_pending: bigint;
  tab_overdue: bigint;
  tab_completed: bigint;
};

// ---------------------------------------------------------------------------
// Query resolution helpers
// ---------------------------------------------------------------------------

function resolveCoordinationQuery(query?: TradieCoordinationQuery): ResolvedCoordinationQuery {
  const rawPage = query?.page ?? 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const rawLimit = query?.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), 50)
    : DEFAULT_PAGE_SIZE;

  return {
    page,
    limit,
    search: query?.search?.trim() ?? "",
    projectId: query?.projectId ?? null,
    tradeType: query?.tradeType ?? null,
    status: query?.status ?? null,
    tab: query?.tab ?? "all",
    sortBy: query?.sortBy ?? "scheduledDate",
    sortOrder: query?.sortOrder === "desc" ? "desc" : "asc",
  };
}

// ---------------------------------------------------------------------------
// Sort column whitelist — never interpolate user input directly
// ---------------------------------------------------------------------------

const SORT_COLUMN_MAP: Record<TradieCoordinationSortBy, string> = {
  scheduledDate: 'ts."scheduledDate"',
  tradieName: "t.name",
  tradeType: "t.\"tradeType\"",
  projectName: "p.name",
  status: 'ts.status::text',
};

function getSortColumn(sortBy: TradieCoordinationSortBy): string {
  return SORT_COLUMN_MAP[sortBy] ?? 'ts."scheduledDate"';
}

// ---------------------------------------------------------------------------
// Shared WHERE fragment builder
//
// Returns a Prisma.Sql fragment (without leading AND/WHERE) that can be
// composed into larger queries.  All values are bound parameters — no string
// interpolation of user data.
//
// "insightsWhere" = ignoreStatus + ignoreTab (base filters only)
// "listWhere"     = full filter including status + tab
// ---------------------------------------------------------------------------

type WhereOptions = {
  ignoreStatus?: boolean;
  ignoreTab?: boolean;
};

function buildWhere(
  resolved: ResolvedCoordinationQuery,
  today: Date,
  nextWeek: Date,
  opts: WhereOptions = {},
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  if (resolved.projectId) {
    parts.push(Prisma.sql`ts."projectId" = ${resolved.projectId}`);
  }

  if (resolved.tradeType) {
    parts.push(Prisma.sql`t."tradeType" = ${resolved.tradeType}`);
  }

  if (resolved.search) {
    const pattern = `%${resolved.search}%`;
    parts.push(Prisma.sql`(
      t.name         ILIKE ${pattern}
      OR t.trade     ILIKE ${pattern}
      OR p.name      ILIKE ${pattern}
      OR m.name      ILIKE ${pattern}
    )`);
  }

  if (!opts.ignoreStatus && resolved.status) {
    parts.push(Prisma.sql`ts.status = ${resolved.status}::"TradieScheduleStatus"`);
  }

  if (!opts.ignoreTab) {
    switch (resolved.tab) {
      case "week":
        parts.push(Prisma.sql`ts."scheduledDate" >= ${today} AND ts."scheduledDate" < ${nextWeek}`);
        break;
      case "confirmed":
        parts.push(Prisma.sql`ts.status = 'CONFIRMED'::"TradieScheduleStatus"`);
        break;
      case "pending":
        parts.push(Prisma.sql`ts.status = ANY(ARRAY['PENDING','PENDING_RESPONSE','NO_RESPONSE']::"TradieScheduleStatus"[])`);
        break;
      case "overdue":
        parts.push(Prisma.sql`ts."scheduledDate" < ${today} AND ts.status <> 'COMPLETED'::"TradieScheduleStatus"`);
        break;
      case "completed":
        parts.push(Prisma.sql`ts.status = 'COMPLETED'::"TradieScheduleStatus"`);
        break;
      // "all" — no extra filter
    }
  }

  if (parts.length === 0) {
    return Prisma.sql`TRUE`;
  }

  // Join all fragments with AND
  return parts.reduce((acc, part) => Prisma.sql`${acc} AND ${part}`);
}

// ---------------------------------------------------------------------------
// Activity label helper (mirrors original mapScheduleStatus)
// ---------------------------------------------------------------------------

function mapScheduleStatus(status: TradieScheduleStatus): { type: TradieActivityItem["type"]; label: string } {
  if (status === TradieScheduleStatus.CONFIRMED || status === TradieScheduleStatus.COMPLETED) {
    return {
      type: "done",
      label: status === TradieScheduleStatus.COMPLETED ? "completed" : "confirmed",
    };
  }
  if (status === TradieScheduleStatus.DECLINED || status === TradieScheduleStatus.NO_RESPONSE) {
    return {
      type: "urgent",
      label: status === TradieScheduleStatus.DECLINED ? "declined" : "had no response",
    };
  }
  return {
    type: "warn",
    label: status === TradieScheduleStatus.PENDING_RESPONSE ? "is pending response" : "is pending",
  };
}

// ---------------------------------------------------------------------------
// Week label helper (mirrors original getWeekLabel)
// ---------------------------------------------------------------------------

function getWeekLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short" }).format(date);
}

// ---------------------------------------------------------------------------
// Safe bigint → number cast
// ---------------------------------------------------------------------------

function n(value: bigint): number {
  return Number(value);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getTradieCoordinationDashboard(
  query?: TradieCoordinationQuery,
): Promise<TradieCoordinationDashboard> {
  const resolved = resolveCoordinationQuery(query);

  // Date anchors (all at midnight UTC to match startOfDay behaviour)
  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 8);
  const prevWeekStart = addDays(today, -7);
  // prevWeekEnd = today (exclusive upper bound)
  const active14Start = addDays(today, -14);
  const active14End = addDays(today, 14);

  // Trend window: date-fns startOfWeek defaults to Sunday (weekStartsOn: 0)
  const trendWindowStart = addDays(startOfWeek(today), -7 * 7); // 7 weeks before current week start
  const trendWindowEnd = addDays(startOfWeek(today), 7);      // 1 week after current week start

  const sortCol = getSortColumn(resolved.sortBy);
  const sortDir = resolved.sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const offset = (resolved.page - 1) * resolved.limit;

  const listWhere = buildWhere(resolved, today, nextWeek);
  const insightsWhere = buildWhere(resolved, today, nextWeek, { ignoreStatus: true, ignoreTab: true });

  try {
    // -----------------------------------------------------------------------
    // All queries fired in parallel
    // -----------------------------------------------------------------------

    const [
      scheduleRows,
      totalCountRows,
      tradeOptionRows,
      totalTradiesRows,
      currentWeekRows,
      prevWeekRows,
      pendingNoResponseRows,
      confirmedCountRows,
      completedCountRows,
      activeTradieRows,
      newTradiesCurrentRows,
      newTradiesPrevRows,
      statusCountRows,
      tabCountRows,
      tradeStatusGroupRows,
      projectAllocationRows,
      utilizationRows,
      activityRows,
      urgentRows,
    ] = await Promise.all([

      // 1. Paginated schedule list
      prisma.$queryRaw<ScheduleRow[]>(Prisma.sql`
        SELECT
          ts.id,
          ts."tradieId"       AS tradie_id,
          t.name              AS tradie_name,
          t."isFavourite"       AS isFavourite,
          t.note              AS note,
          t.abn               AS abn,
          t.trade             AS trade_type,
          ts."projectId"      AS project_id,
          p.name              AS project_name,
          sm.name             AS site_manager_name,
          sm.email            AS site_manager_email,
          sm.phone            AS site_manager_phone,
          ts."milestoneId"    AS milestone_id,
          m.name              AS milestone_name,
          ts."scheduledDate"  AS scheduled_date,
          ts."durationDays"   AS duration_days,
          ts.status,
          t."hourlyRate"::text AS hourly_rate,
          t.rating::text       AS rating,
          ts."reminderSentAt"  AS reminder_sent_at,
          ts."updatedAt"       AS updated_at,
          t.email              AS tradie_email,
          t.phone              AS tradie_phone
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t  ON t.id  = ts."tradieId"
        JOIN "Project" p  ON p.id  = ts."projectId"
        LEFT JOIN "User"      sm ON sm.id = p."siteManagerId"
        LEFT JOIN "Milestone" m  ON m.id  = ts."milestoneId"
        WHERE ${listWhere}
        ORDER BY ${Prisma.raw(sortCol)} ${sortDir}
        LIMIT ${resolved.limit}
        OFFSET ${offset}
      `),

      // 2. Total count for pagination
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${listWhere}
      `),

      // 3. Distinct trade types for filter dropdown
      prisma.$queryRaw<TradeOptionRow[]>(Prisma.sql`
        SELECT DISTINCT "trade" AS trade_type
        FROM "Tradie"
        WHERE "trade" IS NOT NULL
        ORDER BY "trade" ASC
      `),

      // 4. Total registered tradies
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM "Tradie"
      `),

      // 5. Scheduled this week (current)
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts."scheduledDate" >= ${today}
          AND ts."scheduledDate" <  ${nextWeek}
      `),

      // 6. Scheduled previous week
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts."scheduledDate" >= ${prevWeekStart}
          AND ts."scheduledDate" <  ${today}
      `),

      // 7. Pending / no-response count
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts.status = ANY(ARRAY['PENDING','PENDING_RESPONSE','NO_RESPONSE']::"TradieScheduleStatus"[])
      `),

      // 8. Confirmed count
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts.status = 'CONFIRMED'::"TradieScheduleStatus"
      `),

      // 9. Completed count
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts.status = 'COMPLETED'::"TradieScheduleStatus"
      `),

      // 10. Active tradies (distinct tradieId within ±14 days, excluding DECLINED/COMPLETED)
      prisma.$queryRaw<ActiveTradieRow[]>(Prisma.sql`
        SELECT DISTINCT ts."tradieId" AS tradie_id
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts."scheduledDate" >= ${active14Start}
          AND ts."scheduledDate" <= ${active14End}
          AND ts.status <> ALL(ARRAY['DECLINED','COMPLETED']::"TradieScheduleStatus"[])
      `),

      // 11. New tradies in current 30-day window
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "Tradie"
        WHERE "createdAt" >= ${addDays(today, -30)}
      `),

      // 12. New tradies in previous 30-day window (30–60 days ago)
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "Tradie"
        WHERE "createdAt" >= ${addDays(today, -60)}
          AND "createdAt" <  ${addDays(today, -30)}
      `),

      // 13. Status breakdown (all 6 statuses in one pass)
      prisma.$queryRaw<StatusCountRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE ts.status = 'CONFIRMED'::"TradieScheduleStatus")       ::bigint AS confirmed,
          COUNT(*) FILTER (WHERE ts.status = 'PENDING'::"TradieScheduleStatus")         ::bigint AS pending,
          COUNT(*) FILTER (WHERE ts.status = 'PENDING_RESPONSE'::"TradieScheduleStatus")::bigint AS pending_response,
          COUNT(*) FILTER (WHERE ts.status = 'NO_RESPONSE'::"TradieScheduleStatus")     ::bigint AS no_response,
          COUNT(*) FILTER (WHERE ts.status = 'DECLINED'::"TradieScheduleStatus")        ::bigint AS declined,
          COUNT(*) FILTER (WHERE ts.status = 'COMPLETED'::"TradieScheduleStatus")       ::bigint AS completed
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
      `),

      // 14. Tab counts — all 6 tabs in a single pass
      prisma.$queryRaw<TabCountRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS tab_all,
          COUNT(*) FILTER (
            WHERE ts."scheduledDate" >= ${today} AND ts."scheduledDate" < ${nextWeek}
          )::bigint AS tab_week,
          COUNT(*) FILTER (
            WHERE ts.status = 'CONFIRMED'::"TradieScheduleStatus"
          )::bigint AS tab_confirmed,
          COUNT(*) FILTER (
            WHERE ts.status = ANY(ARRAY['PENDING','PENDING_RESPONSE','NO_RESPONSE']::"TradieScheduleStatus"[])
          )::bigint AS tab_pending,
          COUNT(*) FILTER (
            WHERE ts."scheduledDate" < ${today}
              AND ts.status <> 'COMPLETED'::"TradieScheduleStatus"
          )::bigint AS tab_overdue,
          COUNT(*) FILTER (
            WHERE ts.status = 'COMPLETED'::"TradieScheduleStatus"
          )::bigint AS tab_completed
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
      `),

      // 15. Trade × status groups (for tradeBreakdown chart)
      prisma.$queryRaw<TradeStatusGroupRow[]>(Prisma.sql`
        SELECT
          ts."tradieId"  AS tradie_id,
          ts.status,
          COUNT(*)::bigint AS cnt
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
        GROUP BY ts."tradieId", ts.status
      `),

      // 16. Project allocations — top 6, with name joined in the same query
      prisma.$queryRaw<ProjectAllocationRow[]>(Prisma.sql`
        SELECT
          ts."projectId"     AS project_id,
          p.name             AS project_name,
          COUNT(*)::bigint   AS allocation_count
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
        GROUP BY ts."projectId", p.name
        ORDER BY allocation_count DESC
        LIMIT 6
      `),

      // 17. Utilization trend — pre-aggregated by week bucket in DB
      //     date_trunc('week', ...) in PG defaults to Monday; date-fns startOfWeek
      //     defaults to Sunday.  We replicate the Sunday bucket via:
      //     date_trunc('week', "scheduledDate" + interval '1 day') - interval '1 day'
      prisma.$queryRaw<UtilizationRow[]>(Prisma.sql`
        SELECT
          (date_trunc('week', ts."scheduledDate" + INTERVAL '1 day') - INTERVAL '1 day') AS week_start,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (
            WHERE ts.status = ANY(ARRAY['CONFIRMED','COMPLETED']::"TradieScheduleStatus"[])
          )::bigint AS confirmed
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts."scheduledDate" >= ${trendWindowStart}
          AND ts."scheduledDate" <= ${trendWindowEnd}
        GROUP BY week_start
        ORDER BY week_start ASC
      `),

      // 18. Latest activity (last 6 updated schedules)
      prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
        SELECT
          ts.id,
          ts.status,
          ts."updatedAt"  AS updated_at,
          t.name          AS tradie_name,
          p.name          AS project_name
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t ON t.id = ts."tradieId"
        JOIN "Project" p ON p.id = ts."projectId"
        LEFT JOIN "Milestone" m ON m.id = ts."milestoneId"
        WHERE ${insightsWhere}
        ORDER BY ts."updatedAt" DESC
        LIMIT 6
      `),

      // 19. Urgent reminders (scheduled this week, not yet confirmed/completed)
      prisma.$queryRaw<UrgentRow[]>(Prisma.sql`
        SELECT
          ts.id,
          t.name              AS tradie_name,
          t.trade             AS trade_type,
          t.abn               AS abn,
          p.name              AS project_name,
          sm.name             AS site_manager_name,
          sm.email            AS site_manager_email,
          sm.phone            AS site_manager_phone,
          m.name              AS milestone_name,
          ts."scheduledDate"  AS scheduled_date,
          ts.status,
          ts."reminderSentAt" AS reminder_sent_at,
          t.email             AS tradie_email,
          t.phone             AS tradie_phone,
          t."hourlyRate"::text AS hourly_rate,
          t.rating::text       AS rating
        FROM "TradieSchedule" ts
        JOIN "Tradie"  t  ON t.id  = ts."tradieId"
        JOIN "Project" p  ON p.id  = ts."projectId"
        LEFT JOIN "User"      sm ON sm.id = p."siteManagerId"
        LEFT JOIN "Milestone" m  ON m.id  = ts."milestoneId"
        WHERE ${insightsWhere}
          AND ts."scheduledDate" >= ${today}
          AND ts."scheduledDate" <  ${nextWeek}
          AND ts.status <> ALL(ARRAY['CONFIRMED','COMPLETED']::"TradieScheduleStatus"[])
        ORDER BY ts."scheduledDate" ASC
        LIMIT 8
      `),
    ]);

    // -----------------------------------------------------------------------
    // Scalar extractions
    // -----------------------------------------------------------------------

    const totalCount = n(totalCountRows[0]?.count ?? ZERO);
    const totalTradies = n(totalTradiesRows[0]?.count ?? ZERO);
    const currentWeekSched = n(currentWeekRows[0]?.count ?? ZERO);
    const prevWeekSched = n(prevWeekRows[0]?.count ?? ZERO);
    const pendingNoResponse = n(pendingNoResponseRows[0]?.count ?? ZERO);
    const confirmedCount = n(confirmedCountRows[0]?.count ?? ZERO);
    const completedCount = n(completedCountRows[0]?.count ?? ZERO);
    const newTradiesCurrent = n(newTradiesCurrentRows[0]?.count ?? ZERO);
    const newTradiesPrev = n(newTradiesPrevRows[0]?.count ?? ZERO);

    const sc = statusCountRows[0];
    const statusMetrics: TradieStatusMetric[] = [
      { label: "Confirmed", value: n(sc?.confirmed ?? ZERO), status: TradieScheduleStatus.CONFIRMED },
      { label: "Pending", value: n(sc?.pending ?? ZERO), status: TradieScheduleStatus.PENDING },
      { label: "Pending Response", value: n(sc?.pending_response ?? ZERO), status: TradieScheduleStatus.PENDING_RESPONSE },
      { label: "No Response", value: n(sc?.no_response ?? ZERO), status: TradieScheduleStatus.NO_RESPONSE },
      { label: "Declined", value: n(sc?.declined ?? ZERO), status: TradieScheduleStatus.DECLINED },
      { label: "Completed", value: n(sc?.completed ?? ZERO), status: TradieScheduleStatus.COMPLETED },
    ];

    const tc = tabCountRows[0];
    const tabCounts = {
      all: n(tc?.tab_all ?? ZERO),
      week: n(tc?.tab_week ?? ZERO),
      confirmed: n(tc?.tab_confirmed ?? ZERO),
      pending: n(tc?.tab_pending ?? ZERO),
      overdue: n(tc?.tab_overdue ?? ZERO),
      completed: n(tc?.tab_completed ?? ZERO),
    };

    // -----------------------------------------------------------------------
    // Trade breakdown
    // We need tradeType per tradieId — batch-fetch distinct tradieIds
    // -----------------------------------------------------------------------

    const distinctTradieIds = Array.from(new Set(tradeStatusGroupRows.map((r) => r.tradie_id)));

    const tradeTypeRows: TradeTypeRow[] = distinctTradieIds.length > 0
      ? await prisma.$queryRaw<TradeTypeRow[]>(Prisma.sql`
          SELECT id, "trade" AS trade_type
          FROM "Tradie"
          WHERE id::text = ANY(${distinctTradieIds})
        `)
      : [];

    const tradeTypeMap = new Map(tradeTypeRows.map((r) => [r.id, r.trade_type]));
    const tradeBreakdownMap = new Map<string, { total: number; confirmed: number }>();

    for (const row of tradeStatusGroupRows) {
      const tradeType = tradeTypeMap.get(row.tradie_id) ?? "Unknown";
      const current = tradeBreakdownMap.get(tradeType) ?? { total: 0, confirmed: 0 };
      const count = n(row.cnt);
      current.total += count;
      if (row.status === TradieScheduleStatus.CONFIRMED || row.status === TradieScheduleStatus.COMPLETED) {
        current.confirmed += count;
      }
      tradeBreakdownMap.set(tradeType, current);
    }

    const tradeBreakdown = Array.from(tradeBreakdownMap.entries())
      .map(([tradeType, v]) => ({
        tradeType,
        total: v.total,
        confirmedRate: v.total > 0 ? Math.round((v.confirmed / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // -----------------------------------------------------------------------
    // Utilization trend — build the 8-week series and merge DB rows
    // -----------------------------------------------------------------------

    const trendSeries = Array.from({ length: 8 }, (_, i) => {
      const weekStart = addDays(startOfWeek(today), -7 * 7 + i * 7);
      return {
        key: weekStart.toISOString(),
        weekLabel: getWeekLabel(weekStart),
        total: 0,
        confirmed: 0,
      };
    });

    // Map by ISO string of the week-start Date from DB
    const trendMap = new Map(trendSeries.map((p) => [p.key, p]));

    for (const row of utilizationRows) {
      // Normalise: DB returns a Date; convert to the same midnight-UTC key
      const rowWeekStart = startOfDay(row.week_start);
      const key = rowWeekStart.toISOString();
      const target = trendMap.get(key);
      if (!target) continue;
      target.total += n(row.total);
      target.confirmed += n(row.confirmed);
    }

    const utilizationTrend = trendSeries.map((p) => ({
      weekLabel: p.weekLabel,
      utilization: p.total > 0 ? Math.round((p.confirmed / p.total) * 100) : 0,
      target: 80,
    }));

    // -----------------------------------------------------------------------
    // Map schedule rows → TradieScheduleListItem
    // -----------------------------------------------------------------------

    const schedules = scheduleRows.map((row) => ({
      id: row.id,
      tradieId: row.tradie_id,
      tradieName: row.tradie_name,
      tradeType: row.trade_type,
      abn: row.abn,
      projectId: row.project_id,
      projectName: row.project_name,
      isFavourite: row.isFavourite ?? false,
      note: row.note ?? null,
      milestoneId: row.milestone_id ?? undefined,
      milestoneName: row.milestone_name ?? undefined,
      taskLabel: row.milestone_name ?? "General trade task",
      scheduledDate: row.scheduled_date.toISOString(),
      durationDays: row.duration_days,
      status: row.status,
      hourlyRate: row.hourly_rate ?? undefined,
      rating: row.rating ?? undefined,
      reminderSentAt: row.reminder_sent_at?.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      contact: {
        email: row.tradie_email,
        phone: row.tradie_phone,
      },
      siteManager: {
        name: row.site_manager_name ?? "Site manager",
        email: row.site_manager_email ?? "",
        phone: row.site_manager_phone ?? "",
      },
    } satisfies TradieScheduleListItem));

    // -----------------------------------------------------------------------
    // Activity feed
    // -----------------------------------------------------------------------

    const activity = activityRows.map((row) => {
      const mapped = mapScheduleStatus(row.status);
      return {
        id: row.id,
        type: mapped.type,
        message: `${row.tradie_name} ${mapped.label} for ${row.project_name}`,
        createdAt: row.updated_at.toISOString(),
      };
    });

    // -----------------------------------------------------------------------
    // Urgent reminders
    // -----------------------------------------------------------------------

    const urgentReminders = urgentRows.map((row) => ({
      id: row.id,
      tradieName: row.tradie_name,
      tradeType: row.trade_type,
      projectName: row.project_name,
      milestoneName: row.milestone_name ?? undefined,
      taskLabel: row.milestone_name ?? "General trade task",
      scheduledDate: row.scheduled_date.toISOString(),
      daysLeft: differenceInCalendarDays(startOfDay(row.scheduled_date), today),
      abn: row.abn,
      status: row.status,
      contact: {
        email: row.tradie_email,
        phone: row.tradie_phone,
      },
      siteManager: {
        name: row.site_manager_name ?? "Site manager",
        email: row.site_manager_email ?? "",
        phone: row.site_manager_phone ?? "",
      },
      rating: row.rating ?? undefined,
      hourlyRate: row.hourly_rate ?? undefined,
      reminderSentAt: row.reminder_sent_at?.toISOString(),
    }));

    // -----------------------------------------------------------------------
    // Summary metrics
    // -----------------------------------------------------------------------

    const activeTradieCount = activeTradieRows.length;
    const totalScheduledForCompletion = confirmedCount + completedCount + pendingNoResponse;
    const completionRate = totalScheduledForCompletion > 0
      ? Math.round((completedCount / totalScheduledForCompletion) * 100)
      : 0;

    // -----------------------------------------------------------------------
    // Return
    // -----------------------------------------------------------------------

    return {
      query: resolved,
      pagination: {
        page: resolved.page,
        limit: resolved.limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / resolved.limit)),
      },
      schedules,
      summary: {
        registeredTradies: totalTradies,
        registeredTrendDelta: newTradiesCurrent - newTradiesPrev,
        scheduledThisWeek: currentWeekSched,
        scheduledWeekDelta: currentWeekSched - prevWeekSched,
        confirmedBookings: confirmedCount,
        pendingNoResponse,
        activeTradies: activeTradieCount,
        inactiveTradies: Math.max(0, totalTradies - activeTradieCount),
        completionRate,
      },
      tabCounts,
      tradeOptions: tradeOptionRows.map((r) => r.trade_type).filter(Boolean),
      statusMetrics,
      tradeBreakdown,
      projectAllocations: projectAllocationRows.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        allocationCount: n(r.allocation_count),
      })),
      utilizationTrend,
      activity,
      urgentReminders,
    };
  } catch (error) {
    console.error("Error fetching tradie coordination dashboard:", error);

    const empty: TradieCoordinationDashboard = {
      query: resolved,
      pagination: { page: resolved.page, limit: resolved.limit, totalCount: 0, totalPages: 1 },
      schedules: [],
      summary: {
        registeredTradies: 0,
        registeredTrendDelta: 0,
        scheduledThisWeek: 0,
        scheduledWeekDelta: 0,
        confirmedBookings: 0,
        pendingNoResponse: 0,
        activeTradies: 0,
        inactiveTradies: 0,
        completionRate: 0,
      },
      tabCounts: { all: 0, week: 0, confirmed: 0, pending: 0, overdue: 0, completed: 0 },
      tradeOptions: [],
      statusMetrics: [],
      tradeBreakdown: [],
      projectAllocations: [],
      utilizationTrend: [],
      activity: [],
      urgentReminders: [],
    };

    return empty;
  }
}