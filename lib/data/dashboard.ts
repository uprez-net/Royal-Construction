// Server-only, not "use server": only the dashboard page, a Server Component,
// calls these, and as Server Actions the KPI and graph totals across every
// lead and project were an endpoint any signed-in user could post to.
import "server-only";
import type { DashboardKPI } from "@/types/dashboard";
import prisma from "@/lib/prisma";
import {
  LEAD_NOTES_HISTORY_INCLUDE,
  resolveLeadNotesTextOr,
} from "@/lib/leads/notes-text";
import { auth } from "@clerk/nextjs/server";
import { startOfMonth, subMonths, startOfQuarter, subQuarters } from "date-fns";
import type { FollowUpItem } from "@/components/dashboard/dashboard-follow-ups";
import { calculateTrend } from "@/utils/formatters";
import { dueFollowUpTaskWhere } from "@/lib/leads/followup-due";
import { sydneyDateOnly, sydneyWallClockToInstant } from "@/lib/dates/sydney";

type DashboardKPIQueryResult = {
  current_month_projects: bigint;

  current_month_leads: bigint;
  previous_month_leads: bigint;

  current_month_converted_leads: bigint;
  previous_month_converted_leads: bigint;

  active_projects: bigint;
  active_site_managers: bigint;

  current_quarter_revenue: number | null;
  previous_quarter_revenue: number | null;

  current_quarter_estimated_spend: number | null;
  previous_quarter_estimated_spend: number | null;

  current_quarter_actual_spend: number | null;
  previous_quarter_actual_spend: number | null;
};

/**
 * Gets key performance indicator data for the dashboard, including trends compared to previous periods. Requires user authentication and aggregates data across leads, projects, and milestones to provide insights on follow-ups, new leads, conversions, revenue, and spending.
 * @returns DashboardKPI object containing various metrics and their trends
 * @throws Error if user is not authenticated or if database queries fail
 */
export async function getDashboardKPIData(): Promise<DashboardKPI> {
  try {
    const { userId } = await auth();

    if (!userId) {
      throw new Error("Unauthorized");
    }

    const now = new Date();

    const currentMonthStart = startOfMonth(now);
    const previousMonthStart = startOfMonth(subMonths(now, 1));

    const currentQuarterStart = startOfQuarter(now);
    const previousQuarterStart = startOfQuarter(subQuarters(now, 1));

    // The follow-up count is deliberately NOT part of this query. It used to
    // be, and it read zero for every user on every load: the CTE compared
    // `Lead.assignedId` — a `User.id` uuid — against the Clerk id `auth()`
    // returns, two identifier spaces that never match. Nothing failed; the KPI
    // just sat at 0 beside a card listing fifteen outstanding items.
    //
    // Counting through the same predicate the list below uses is the fix for
    // the class, not only the instance: the header number and the card cannot
    // now disagree, because there is one query behind both.
    const [followUpsCount, [result]] = await Promise.all([
      prisma.leadTask.count({ where: dueFollowUpTaskWhere(now) }),
      prisma.$queryRaw<DashboardKPIQueryResult[]>`
            WITH lead_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE "createdAt" >= ${currentMonthStart}
                    ) AS current_month_leads,

                    COUNT(*) FILTER (
                        WHERE "createdAt" >= ${previousMonthStart}
                        AND "createdAt" < ${currentMonthStart}
                    ) AS previous_month_leads,

                    COUNT(*) FILTER (
                        WHERE stage IN ('WON', 'CONVERTED')
                        AND "updatedAt" >= ${currentMonthStart}
                    ) AS current_month_converted_leads,

                    COUNT(*) FILTER (
                        WHERE stage IN ('WON', 'CONVERTED')
                        AND "updatedAt" >= ${previousMonthStart}
                        AND "updatedAt" < ${currentMonthStart}
                    ) AS previous_month_converted_leads
                FROM "Lead"
                WHERE "isArchived" = false
            ),

            project_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE "createdAt" >= ${currentMonthStart}
                    ) AS current_month_projects,

                    COUNT(*) FILTER (
                        WHERE status = 'ACTIVE'
                    ) AS active_projects,

                    COUNT(DISTINCT "siteManagerId") FILTER (
                        WHERE status = 'ACTIVE'
                        AND "siteManagerId" IS NOT NULL
                    ) AS active_site_managers,

                    COALESCE(
                        SUM("totalBudget") FILTER (
                            WHERE "createdAt" >= ${currentQuarterStart}
                        ),
                        0
                    ) AS current_quarter_revenue,

                    COALESCE(
                        SUM("totalBudget") FILTER (
                            WHERE "createdAt" >= ${previousQuarterStart}
                            AND "createdAt" < ${currentQuarterStart}
                        ),
                        0
                    ) AS previous_quarter_revenue
                FROM "Project"
            ),

            milestone_stats AS (
                SELECT
                    COALESCE(
                        SUM(budget) FILTER (
                            WHERE "targetDate" >= ${currentQuarterStart}
                        ),
                        0
                    ) AS current_quarter_estimated_spend,

                    COALESCE(
                        SUM(budget) FILTER (
                            WHERE "targetDate" >= ${previousQuarterStart}
                            AND "targetDate" < ${currentQuarterStart}
                        ),
                        0
                    ) AS previous_quarter_estimated_spend,

                    COALESCE(
                        SUM(spend) FILTER (
                            WHERE "targetDate" >= ${currentQuarterStart}
                        ),
                        0
                    ) AS current_quarter_actual_spend,

                    COALESCE(
                        SUM(spend) FILTER (
                            WHERE "targetDate" >= ${previousQuarterStart}
                            AND "targetDate" < ${currentQuarterStart}
                        ),
                        0
                    ) AS previous_quarter_actual_spend
                FROM "Milestone"
            )

            SELECT *
            FROM lead_stats
            CROSS JOIN project_stats
            CROSS JOIN milestone_stats;
            `,
    ]);

    const currentRevenue = Number(result.current_quarter_revenue);
    const previousRevenue = Number(result.previous_quarter_revenue);

    const currentEstimatedSpend = Number(
      result.current_quarter_estimated_spend,
    );

    const previousEstimatedSpend = Number(
      result.previous_quarter_estimated_spend,
    );

    const currentActualSpend = Number(result.current_quarter_actual_spend);

    const previousActualSpend = Number(result.previous_quarter_actual_spend);

    const currentProfit = currentRevenue - currentActualSpend;
    const previousProfit = previousRevenue - previousActualSpend;

    return {
      followUpsCount,

      newProjectsCount: Number(result.current_month_projects),

      newLeadsThisMonth: calculateTrend(
        Number(result.current_month_leads),
        Number(result.previous_month_leads),
      ),

      newLeadsConvertedThisMonth: calculateTrend(
        Number(result.current_month_converted_leads),
        Number(result.previous_month_converted_leads),
      ),

      revenueThisQuarter: calculateTrend(currentRevenue, previousRevenue),

      netProfitThisQuarter: calculateTrend(currentProfit, previousProfit),

      activeProjects: {
        total: Number(result.active_projects),
        trendDelta: 0,
      },

      activeSiteManagers: {
        total: Number(result.active_site_managers),
        trendDelta: 0,
      },

      estimateProjectSpendingThisQuarter: calculateTrend(
        currentEstimatedSpend,
        previousEstimatedSpend,
      ),

      actualProjectSpendingThisQuarter: calculateTrend(
        currentActualSpend,
        previousActualSpend,
      ),
    };
  } catch (error) {
    console.error("Error fetching dashboard KPI data:", error);
    throw new Error("Failed to fetch dashboard KPI data");
  }
}
/**
 * The outstanding follow-ups behind the dashboard card, oldest first.
 *
 * Reads `LeadTask`. The old version read `Lead.followupDate` and
 * `Lead.followupCompletedAt`, which is a list no operator could ever clear —
 * see `dueFollowUpTaskWhere` for why. On staging it showed fifteen leads, all
 * of them overdue since April to June, fourteen of which had their follow-up
 * task completed; the one genuinely open task belonged to a lead marked Lost.
 *
 * The assignee filter is gone with it. It was never doing the job it looks
 * like it was doing: 47 of 66 leads carry no `assignedId` at all, including
 * every one of those fifteen, so scoping to the signed-in user hid the work
 * rather than focusing it. Nothing else on this dashboard is per-user — new
 * leads, new projects and revenue are all business-wide — and neither is the
 * Follow-ups tab this card sends you to.
 */
export async function getDashboardFollowUps(): Promise<FollowUpItem[]> {
  try {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const tasks = await prisma.leadTask.findMany({
      where: dueFollowUpTaskWhere(),
      select: {
        id: true,
        dueDate: true,
        // Needed to render a time at all. `dueDate` is always Sydney midnight
        // — `sydneyStartOfDay` of the chosen day — and the clock face lives in
        // `dueTime` beside it. Reading the date alone puts "12:00 AM" on the
        // card next to every call and site meeting.
        dueTime: true,
        notes: true,
        lead: {
          select: {
            name: true,
            location: true,
            notes: true,
            notesDoc: true,
            // The note fallback is only as good as what the query loaded. The
            // Notes composer clears `notes` AND `notesDoc` and stores the text
            // as history, so without these rows every composed note reads "No
            // additional details" here — the resolver cannot invent what was
            // never selected.
            history: LEAD_NOTES_HISTORY_INCLUDE,
          },
        },
      },
      // Longest overdue first, which is the order the card's "N days overdue"
      // badge makes sense in. Ties broken by id so the list is stable across
      // loads rather than reshuffling under whatever order the planner picks.
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    });

    // flatMap rather than map so the "dated only" contract is enforced by the
    // code and not merely asserted with a `!`. The predicate already excludes
    // undated tasks; this is what keeps that true if it ever stops being.
    return tasks.flatMap<FollowUpItem>((task) =>
      task.dueDate === null
        ? []
        : [
            {
              // The task, not the lead: one lead can have several pieces of
              // open work, and this id is the React key for the row.
              id: task.id,
              customerName: task.lead.name,
              projectName: task.lead.location,
              // What this particular follow-up is about, falling back to the
              // lead's notes when the task carries none.
              description:
                task.notes?.trim() ||
                resolveLeadNotesTextOr(task.lead, "No additional details"),
              // The instant the work is actually due, rebuilt from the Sydney
              // wall clock the two columns store between them. Handing the
              // card `dueDate` on its own would date every row correctly and
              // time every one of them at midnight.
              dueAt: sydneyWallClockToInstant(
                sydneyDateOnly(task.dueDate),
                task.dueTime ?? undefined,
              ),
              // Everything here is due today or already past it, so there is
              // no "positive" case left to express. The badge still
              // distinguishes "Due today" from "N days overdue"; the colour
              // does not.
              status: "negative",
            },
          ],
    );
  } catch (error) {
    console.error("Error fetching follow-up items:", error);
    throw new Error("Failed to fetch follow-up items");
  }
}

/**
 * Gets graph data for the dashboard, including non-conversion reasons, lead and revenue trends over the past year, conversion breakdowns, and estimated vs actual spending. Requires user authentication and aggregates data across multiple dimensions to provide insights for visualizations.
 * @returns Promise resolving to an object containing the graph data
 * @throws Error if user is not authenticated or if database queries fail
 */
export async function getDashboardGraphData() {
  try {
    const { userId } = await auth();
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const [
      nonConversionData,
      leadAndRevenueDataUptoPastYear,
      conversionBreakdownData,
      estVsSpendProjectData,
    ] = await Promise.all([
      prisma.$queryRaw<
        {
          name: string | null;
          value: bigint;
        }[]
      >`
                SELECT
                  COALESCE("lostReason", 'Unknown') AS name,
                  COUNT(*) AS value
                FROM "Lead"
                WHERE stage IN ('LOST', 'CANCELLED', 'DISQUALIFIED') AND "isArchived" = false
                GROUP BY COALESCE("lostReason", 'Unknown')
                ORDER BY value DESC
              `,

      prisma.$queryRaw<
        {
          month: Date;
          leads: bigint;
          converted: bigint;
          revenue: bigint;
        }[]
      >`
                WITH months AS (
                    SELECT generate_series(
                        DATE_TRUNC('month', NOW() - INTERVAL '11 months'),
                        DATE_TRUNC('month', NOW()),
                        INTERVAL '1 month'
                    ) AS month
                ),
                lead_stats AS (
                    SELECT
                        DATE_TRUNC('month', "createdAt") AS month,
                        COUNT(*) AS leads,
                        COUNT(*) FILTER (WHERE stage IN ('WON', 'CONVERTED')) AS converted
                    FROM "Lead"
                    WHERE "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '11 months') AND "isArchived" = false
                    GROUP BY 1
                ),
                project_revenue AS (
                    SELECT
                        DATE_TRUNC('month', "createdAt") AS month,
                        COALESCE(SUM("totalBudget"), 0) AS revenue
                    FROM "Project"
                    WHERE "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '11 months')
                    GROUP BY 1
                )
                SELECT
                    m.month,
                    COALESCE(ls.leads, 0)    AS leads,
                    COALESCE(ls.converted, 0) AS converted,
                    COALESCE(pr.revenue, 0)  AS revenue
                FROM months m
                LEFT JOIN lead_stats ls    ON ls.month = m.month
                LEFT JOIN project_revenue pr ON pr.month = m.month
                ORDER BY m.month;
                  `,
      prisma.$queryRaw<
        {
          stage: "converted" | "pending" | "lost" | "nurture";
          value: bigint;
        }[]
      >`
            SELECT
                CASE
                WHEN stage IN ('WON', 'CONVERTED')
                    THEN 'converted'

                WHEN stage IN ('LOST', 'CANCELLED', 'DISQUALIFIED')
                    THEN 'lost'

                WHEN stage IN ('NEW', 'CONTACTED', 'DISCOVERY', 'QUALIFIED')
                    THEN 'nurture'

                -- MEETING_SCHEDULED and IN_FOLLOW_UP stay listed only because
                -- rows hold them until the data migration has run everywhere.
                WHEN stage IN (
                    'QUOTED',
                    'NEGOTIATING',
                    'MEETING_SCHEDULED',
                    'IN_FOLLOW_UP',
                    'NO_RESPONSE'
                )
                    THEN 'pending'
                ELSE 'nurture'
                END AS stage,

                COUNT(*) AS value

            FROM "Lead"
            WHERE "isArchived" = false
            GROUP BY 1
            `,
      prisma.$queryRaw<
        {
          month: Date;
          estimateSpend: number;
          actualSpend: number;
        }[]
      >`
                SELECT
                    DATE_TRUNC('month', "targetDate") AS month,
                    COALESCE(SUM("budget"), 0) AS "estimateSpend",
                    COALESCE(SUM("spend"), 0) AS "actualSpend"
                FROM "Milestone"
                WHERE "targetDate" >= ${startOfMonth(subMonths(new Date(), 11))}
                GROUP BY 1
                ORDER BY 1;
                `,
    ]);

    const formattedNonConversionData = nonConversionData.map((item) => ({
      name: item.name ?? "Unknown",
      value: Number(item.value),
    }));

    const formattedLeadAndRevenueData = leadAndRevenueDataUptoPastYear.map(
      (item) => ({
        month: item.month,
        leads: Number(item.leads),
        converted: Number(item.converted),
        revenue: Number(item.revenue),
      }),
    );

    const formattedConversionBreakdownData = conversionBreakdownData.map(
      (item) => ({
        stage: item.stage,
        value: Number(item.value),
      }),
    );

    const formattedEstVsSpendProjectData = estVsSpendProjectData.map(
      (item) => ({
        month: item.month,
        estimateSpend: Number(item.estimateSpend),
        actualSpend: Number(item.actualSpend),
      }),
    );

    return {
      nonConversionData: formattedNonConversionData,
      leadAndRevenueData: formattedLeadAndRevenueData,
      conversionBreakdownData: formattedConversionBreakdownData,
      estVsSpendProjectData: formattedEstVsSpendProjectData,
    };
  } catch (error) {
    console.error("Error fetching dashboard graph data:", error);
    throw new Error("Failed to fetch dashboard graph data");
  }
}

export type DashboardGraphData = Awaited<
  ReturnType<typeof getDashboardGraphData>
>;
