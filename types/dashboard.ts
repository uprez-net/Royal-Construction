import type { DataPoint } from "@/components/common/metric-card";

export interface DashboardKPI {
    followUpsCount: number;
    newProjectsCount: number;
    newLeadsThisMonth: DataPoint;
    newLeadsConvertedThisMonth: DataPoint;
    revenueThisQuarter: DataPoint;
    netProfitThisQuarter: DataPoint;
    activeProjects: DataPoint;
    activeSiteManagers: DataPoint;
    estimateProjectSpendingThisQuarter: DataPoint;
    actualProjectSpendingThisQuarter: DataPoint;
}