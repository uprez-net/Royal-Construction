"use client";
import { KpiBand, MOBILE_METRIC_STRIP_CLASS } from "../common/kpi-band";
import { KPIListItem, MetricCard } from "../common/metric-card";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/lib/store/hooks";

export function TradieApprovalKPI() {
  const { kpiData } = useAppSelector((state) => state.tradieApproval);
  const allKPIs: KPIListItem[] = [
    {
      title: "Pending Approvals",
      dataPoint: {
        total: kpiData.pendingCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
    {
      title: "Price Changes",
      dataPoint: {
        total: kpiData.priceChangeCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      isInverse: true,
    },
    {
      title: "Incident",
      dataPoint: {
        total: kpiData.incidentReportCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
    {
      title: "Deletions",
      dataPoint: {
        total: kpiData.deletionCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
    {
      title: "Scheduling",
      dataPoint: {
        total: kpiData.scheduleCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
    {
      title: "Schedule Removals",
      dataPoint: {
        total: kpiData.scheduleDeletionCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
    {
      title: "Resolved Approvals",
      dataPoint: {
        total: kpiData.resolvedCount.accepted + kpiData.resolvedCount.rejected,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
    },
  ];

  return (
    <KpiBand
      className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-2 xl:grid-cols-7")}
    >
      {allKPIs.map((kpi, index) => (
        <MetricCard
          key={index}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          isInverse={kpi.isInverse}
        />
      ))}
    </KpiBand>
  );
}
