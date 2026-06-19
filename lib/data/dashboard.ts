"use server";
import type { DashboardKPI } from "@/types/dashboard";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import {
    startOfMonth,
    subMonths,
    startOfQuarter,
    subQuarters,
    isPast,
    isToday
} from "date-fns";
import { LeadStage } from "@prisma/client";
import type { FollowUpItem } from "@/components/dashboard/dashboard-follow-ups";
import { calculateTrend } from "@/utils/formatters";
import { getUserByClerkId } from "@/lib/data/user";

type DashboardKPIQueryResult = {
    follow_ups_count: bigint;

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

        const [result] = await prisma.$queryRaw<DashboardKPIQueryResult[]>`
            WITH lead_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE (
                            ("assignedId" = ${userId}
                            AND stage = 'IN_FOLLOW_UP')
                            OR "followupDate" <= ${now}
                        )
                    ) AS follow_ups_count,

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
            `;

        const currentRevenue = Number(result.current_quarter_revenue);
        const previousRevenue = Number(result.previous_quarter_revenue);

        const currentEstimatedSpend = Number(
            result.current_quarter_estimated_spend
        );

        const previousEstimatedSpend = Number(
            result.previous_quarter_estimated_spend
        );

        const currentActualSpend = Number(
            result.current_quarter_actual_spend
        );

        const previousActualSpend = Number(
            result.previous_quarter_actual_spend
        );

        const currentProfit = currentRevenue - currentActualSpend;
        const previousProfit = previousRevenue - previousActualSpend;

        return {
            followUpsCount: Number(result.follow_ups_count),

            newProjectsCount: Number(result.current_month_projects),

            newLeadsThisMonth: calculateTrend(
                Number(result.current_month_leads),
                Number(result.previous_month_leads)
            ),

            newLeadsConvertedThisMonth: calculateTrend(
                Number(result.current_month_converted_leads),
                Number(result.previous_month_converted_leads)
            ),

            revenueThisQuarter: calculateTrend(
                currentRevenue,
                previousRevenue
            ),

            netProfitThisQuarter: calculateTrend(
                currentProfit,
                previousProfit
            ),

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
                previousEstimatedSpend
            ),

            actualProjectSpendingThisQuarter: calculateTrend(
                currentActualSpend,
                previousActualSpend
            ),
        };
    } catch (error) {
        console.error("Error fetching dashboard KPI data:", error);
        throw new Error("Failed to fetch dashboard KPI data");
    }
}
/**
 * Gets follow-up items for the dashboard, showing leads that are either in the follow-up stage or have a follow-up date that is due. Requires user authentication and returns items with status indicators based on due dates.
 * @returns Array of FollowUpItem objects containing lead information and follow-up status
 * @throws Error if user is not authenticated or if database queries fail
 */
export async function getDashboardFollowUps(): Promise<FollowUpItem[]> {
    try {
        const { userId } = await auth();
        if (!userId) {
            throw new Error("Unauthorized");
        }
        const user = await getUserByClerkId(userId);
        if (!user) {
            throw new Error("Unauthorized");
        }

        const now = new Date();

        const followUps = await prisma.lead.findMany({
            where: {
                OR: [
                    {
                        assignedId: user.id,
                        stage: LeadStage.IN_FOLLOW_UP,
                    },
                    {
                        assignedId: user.id,
                        followupDate: {
                            lte: now,
                        },
                    }
                ]
            },
            orderBy: {
                followupDate: "desc",
            },
        });

        return followUps.map((lead) => ({
            id: lead.id,
            customerName: lead.name,
            projectName: lead.location,
            description: lead.notes ?? "No additional details",
            dueAt: lead.followupDate ?? now,
            status:
                lead.followupDate
                    ?
                    isToday(new Date(lead.followupDate))
                        ? "negative"
                        : isPast(new Date(lead.followupDate))
                            ? "negative"
                            : "positive"
                    : "neutral", // if follow-up is overdue, set to "negative", if due today, set to "negative", if due in the future, set to "positive"
        }));
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

        const [nonConversionData, leadAndRevenueDataUptoPastYear, conversionBreakdownData, estVsSpendProjectData] = await Promise.all([
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
                WHERE stage IN ('LOST', 'CANCELLED', 'DISQUALIFIED')
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
                    WHERE "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '11 months')
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

                WHEN stage IN ('NEW', 'CONTACTED', 'QUALIFIED')
                    THEN 'nurture'

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
                `
        ]);

        const formattedNonConversionData = nonConversionData.map((item) => ({
            name: item.name ?? "Unknown",
            value: Number(item.value),
        }));

        const formattedLeadAndRevenueData = leadAndRevenueDataUptoPastYear.map((item) => ({
            month: item.month,
            leads: Number(item.leads),
            converted: Number(item.converted),
            revenue: Number(item.revenue),
        }));

        const formattedConversionBreakdownData = conversionBreakdownData.map((item) => ({
            stage: item.stage,
            value: Number(item.value),
        }));

        const formattedEstVsSpendProjectData = estVsSpendProjectData.map((item) => ({
            month: item.month,
            estimateSpend: Number(item.estimateSpend),
            actualSpend: Number(item.actualSpend),
        }));

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

export type DashboardGraphData = Awaited<ReturnType<typeof getDashboardGraphData>>;
