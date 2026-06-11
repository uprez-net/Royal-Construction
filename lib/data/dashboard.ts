"use server";
import type { DashboardKPI } from "@/types/dashboard";
import type { DataPoint } from "@/components/common/metric-card";
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
import { ProjectStatus, LeadStage } from "@prisma/client";
import type { FollowUpItem } from "@/components/dashboard/dashboard-follow-ups";
import { calculateTrend } from "@/utils/formatters";

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
        const previousProfit =
            previousRevenue > 0
                ? previousRevenue - previousActualSpend
                : 0;

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

export async function getDashboardFollowUps(): Promise<FollowUpItem[]> {
    try {
        const { userId } = await auth();
        if (!userId) {
            throw new Error("Unauthorized");
        }

        const now = new Date();

        const followUps = await prisma.lead.findMany({
            where: {
                OR: [
                    {
                        assignedId: userId,
                        stage: LeadStage.IN_FOLLOW_UP,
                    },
                    {
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