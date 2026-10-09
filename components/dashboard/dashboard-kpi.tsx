"use client";
import {
  Banknote,
  Calculator,
  CheckCircle2,
  ClipboardList,
  TrendingUp,
  UserCog,
  UserPlus,
} from "lucide-react";
import type { DataPoint, KPIListItem } from "../common/metric-card";
import { TrendBadge } from "../common/trend-badge";
import { compactCurrency } from "@/utils/formatters";
import { cn } from "@/lib/utils";

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
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {allKPIs.map((kpi) => (
        <div
          key={kpi.title}
          className="grid min-h-18 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border/70 bg-white/95 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3 sm:px-4"
        >
          <div
            className={cn(
              "grid size-7 place-items-center rounded-lg text-white sm:size-9",
              kpi.iconTone,
            )}
          >
            <kpi.Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xl font-semibold leading-none text-foreground">
              {kpi.isCurrency
                ? compactCurrency.format(kpi.dataPoint.total)
                : kpi.dataPoint.total}
            </p>
            <p className="mt-1 text-xs text-muted-foreground sm:truncate">
              {kpi.title}
            </p>
          </div>
          <div className="col-start-2 min-w-0 sm:col-start-auto sm:min-w-12 sm:justify-self-end sm:text-right">
            {kpi.dataPoint.trendDelta !== 0 ? (
              <TrendBadge value={kpi.dataPoint.trendDelta} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
