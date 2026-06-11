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

function calculateTrend(
    current: number,
    previous: number
): DataPoint {
    if (previous === 0) {
        return {
            total: current,
            trendDelta: current > 0 ? 100 : 0,
        };
    }

    return {
        total: current,
        trendDelta: Number(
            (((current - previous) / previous) * 100).toFixed(1)
        ),
    };
}

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

        const [
            followUpsCount,

            currentMonthProjects,

            currentMonthLeads,
            previousMonthLeads,

            currentMonthConvertedLeads,
            previousMonthConvertedLeads,

            activeProjects,

            activeSiteManagers,

            currentQuarterRevenue,
            previousQuarterRevenue,

            currentQuarterEstimatedSpend,
            previousQuarterEstimatedSpend,

            currentQuarterActualSpend,
            previousQuarterActualSpend,
        ] = await Promise.all([
            // Follow ups
            prisma.lead.count({
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
            }),

            // New projects this month
            prisma.project.count({
                where: {
                    createdAt: {
                        gte: currentMonthStart,
                    },
                },
            }),

            // Current month leads
            prisma.lead.count({
                where: {
                    createdAt: {
                        gte: currentMonthStart,
                    },
                },
            }),

            // Previous month leads
            prisma.lead.count({
                where: {
                    createdAt: {
                        gte: previousMonthStart,
                        lt: currentMonthStart,
                    },
                },
            }),

            // Current month converted leads
            prisma.lead.count({
                where: {
                    stage: { in: [LeadStage.WON, LeadStage.CONVERTED] }, // replace if different
                    updatedAt: {
                        gte: currentMonthStart,
                    },
                },
            }),

            // Previous month converted leads
            prisma.lead.count({
                where: {
                    stage: { in: [LeadStage.WON, LeadStage.CONVERTED] }, // replace if different
                    updatedAt: {
                        gte: previousMonthStart,
                        lt: currentMonthStart,
                    },
                },
            }),

            // Active projects
            prisma.project.count({
                where: {
                    status: ProjectStatus.ACTIVE,
                },
            }),

            // Active site managers
            prisma.project.findMany({
                where: {
                    status: ProjectStatus.ACTIVE,
                    siteManagerId: {
                        not: null,
                    },
                },
                select: {
                    siteManagerId: true,
                },
                distinct: ["siteManagerId"],
            }),

            // Current quarter revenue
            prisma.project.aggregate({
                where: {
                    createdAt: {
                        gte: currentQuarterStart,
                    },
                },
                _sum: {
                    totalBudget: true,
                },
            }),

            // Previous quarter revenue
            prisma.project.aggregate({
                where: {
                    createdAt: {
                        gte: previousQuarterStart,
                        lt: currentQuarterStart,
                    },
                },
                _sum: {
                    totalBudget: true,
                },
            }),

            // Current quarter estimated spend
            prisma.milestone.aggregate({
                where: {
                    targetDate: {
                        gte: currentQuarterStart,
                    },
                },
                _sum: {
                    budget: true,
                },
            }),

            // Previous quarter estimated spend
            prisma.milestone.aggregate({
                where: {
                    targetDate: {
                        gte: previousQuarterStart,
                        lt: currentQuarterStart,
                    },
                },
                _sum: {
                    budget: true,
                },
            }),

            // Current quarter actual spend
            prisma.milestone.aggregate({
                where: {
                    targetDate: {
                        gte: currentQuarterStart,
                    },
                },
                _sum: {
                    spend: true,
                },
            }),

            // Previous quarter actual spend
            prisma.milestone.aggregate({
                where: {
                    targetDate: {
                        gte: previousQuarterStart,
                        lt: currentQuarterStart,
                    },
                },
                _sum: {
                    spend: true,
                },
            }),
        ]);

        const currentRevenue = Number(
            currentQuarterRevenue._sum.totalBudget ?? 0
        );

        const previousRevenue = Number(
            previousQuarterRevenue._sum.totalBudget ?? 0
        );

        const currentEstimatedSpend = Number(
            currentQuarterEstimatedSpend._sum.budget ?? 0
        );

        const previousEstimatedSpend = Number(
            previousQuarterEstimatedSpend._sum.budget ?? 0
        );

        const currentActualSpend = Number(
            currentQuarterActualSpend._sum.spend ?? 0
        );

        const previousActualSpend = Number(
            previousQuarterActualSpend._sum.spend ?? 0
        );

        const currentProfit = currentRevenue - currentActualSpend;
        const previousProfit = previousRevenue > 0 ? previousRevenue - previousActualSpend : 0;

        return {
            followUpsCount,

            newProjectsCount: currentMonthProjects,

            newLeadsThisMonth: calculateTrend(
                currentMonthLeads,
                previousMonthLeads
            ),

            newLeadsConvertedThisMonth: calculateTrend(
                currentMonthConvertedLeads,
                previousMonthConvertedLeads
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
                total: activeProjects,
                trendDelta: 0,
            },

            activeSiteManagers: {
                total: activeSiteManagers.length,
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