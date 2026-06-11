"use client"
import {
  Banknote,
  Calculator,
  CheckCircle2,
  ClipboardList,
  TrendingUp,
  UserCog,
  UserPlus,
} from "lucide-react";
import { DataPoint, KPIListItem, MetricCard } from "../common/metric-card";

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
      Icon: UserPlus,
      iconTone: "bg-teal-600",
    },
    {
      title: `New Leads Converted (${conversionPercentage.toFixed(2)}%)`,
      dataPoint: newLeadsConvertedThisMonth,
      Icon: CheckCircle2,
      iconTone: "bg-green-600",
    },
    {
      title: "Revenue This Quarter",
      dataPoint: revenueThisQuarter,
      Icon: Banknote,
      iconTone: "bg-orange-600",
      isCurrency: true,
    },
    {
      title: "Net Profit This Quarter",
      dataPoint: netProfitThisQuarter,
      Icon: TrendingUp,
      iconTone: "bg-red-600",
      isCurrency: true,
    },
    {
      title: "Active Projects",
      dataPoint: activeProjects,
      Icon: ClipboardList,
      iconTone: "bg-blue-600",
    },
    {
      title: "Active Site Managers",
      dataPoint: activeSiteManagers,
      Icon: UserCog,
      iconTone: "bg-purple-600",
    },
    {
      title: "Est. Spend",
      dataPoint: estimateProjectSpendingThisQuarter,
      Icon: Calculator,
      iconTone: "bg-green-600",
      isCurrency: true,
    },
    {
      title: "Actual Spend",
      dataPoint: actualProjectSpendingThisQuarter,
      Icon: Calculator,
      iconTone: "bg-red-600",
      isCurrency: true,
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {allKPIs.map((kpi) => (
        <MetricCard
          key={kpi.title}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          Icon={kpi.Icon}
          iconTone={kpi.iconTone}
          isCurrency={kpi.isCurrency}
        />
      ))}
    </div>
  );
}
