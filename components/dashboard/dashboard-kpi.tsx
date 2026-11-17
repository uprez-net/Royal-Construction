"use client";
import { KpiBand } from "../common/kpi-band";
import {
  MetricCard,
  type DataPoint,
  type KPIListItem,
} from "../common/metric-card";

interface DashboardKPIProps {
  newLeadsThisMonth: DataPoint;
  newLeadsConvertedThisMonth: DataPoint;
  revenueThisQuarter: DataPoint;
  netProfitThisQuarter: DataPoint;
  activeProjects: DataPoint;
  activeSiteManagers: DataPoint;
  estimateProjectSpendingThisQuarter: DataPoint;
  actualProjectSpendingThisQuarter: DataPoint;
}

export function DashboardKPI({
  newLeadsThisMonth,
  newLeadsConvertedThisMonth,
  revenueThisQuarter,
  netProfitThisQuarter,
  activeProjects,
  activeSiteManagers,
  estimateProjectSpendingThisQuarter,
  actualProjectSpendingThisQuarter,
}: DashboardKPIProps) {
  const conversionPercentage =
    newLeadsThisMonth.total > 0
      ? (newLeadsConvertedThisMonth.total / newLeadsThisMonth.total) * 100
      : 0;
  const allKPIs: KPIListItem[] = [
    {
      title: "New Leads This Month",
      dataPoint: newLeadsThisMonth,
    },
    {
      title: `New Leads Converted (${conversionPercentage.toFixed(2)}%)`,
      dataPoint: newLeadsConvertedThisMonth,
    },
    {
      title: "Revenue This Quarter",
      dataPoint: revenueThisQuarter,
      isCurrency: true,
    },
    {
      title: "Net Profit This Quarter",
      dataPoint: netProfitThisQuarter,
      isCurrency: true,
    },
    {
      title: "Active Projects",
      dataPoint: activeProjects,
    },
    {
      title: "Active Site Managers",
      dataPoint: activeSiteManagers,
    },
    {
      title: "Est. Spend",
      dataPoint: estimateProjectSpendingThisQuarter,
      isCurrency: true,
    },
    {
      title: "Actual Spend",
      dataPoint: actualProjectSpendingThisQuarter,
      isCurrency: true,
    },
  ];
  return (
    <KpiBand className="grid-cols-2 xl:grid-cols-4">
      {allKPIs.map((kpi) => (
        <MetricCard
          key={kpi.title}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          isCurrency={kpi.isCurrency}
        />
      ))}
    </KpiBand>
  );
}
