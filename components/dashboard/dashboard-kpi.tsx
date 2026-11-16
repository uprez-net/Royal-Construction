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
import {
  METRIC_TONES,
  type DataPoint,
  type KPIListItem,
  type MetricTone,
} from "../common/metric-card";
import { TrendBadge } from "../common/trend-badge";
import { compactCurrency } from "@/utils/formatters";
import { cn } from "@/lib/utils";

type KPIItem = Omit<KPIListItem, "iconTone" | "tone"> & { tone: MetricTone };

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
  const allKPIs: KPIItem[] = [
    {
      title: "New Leads This Month",
      dataPoint: newLeadsThisMonth,
      Icon: UserPlus,
      tone: "neutral",
    },
    {
      title: `New Leads Converted (${conversionPercentage.toFixed(2)}%)`,
      dataPoint: newLeadsConvertedThisMonth,
      Icon: CheckCircle2,
      tone: "success",
    },
    {
      title: "Revenue This Quarter",
      dataPoint: revenueThisQuarter,
      Icon: Banknote,
      tone: "neutral",
      isCurrency: true,
    },
    {
      title: "Net Profit This Quarter",
      dataPoint: netProfitThisQuarter,
      Icon: TrendingUp,
      tone: "neutral",
      isCurrency: true,
    },
    {
      title: "Active Projects",
      dataPoint: activeProjects,
      Icon: ClipboardList,
      tone: "info",
    },
    {
      title: "Active Site Managers",
      dataPoint: activeSiteManagers,
      Icon: UserCog,
      tone: "neutral",
    },
    {
      title: "Est. Spend",
      dataPoint: estimateProjectSpendingThisQuarter,
      Icon: Calculator,
      tone: "success",
      isCurrency: true,
    },
    {
      title: "Actual Spend",
      dataPoint: actualProjectSpendingThisQuarter,
      Icon: Calculator,
      tone: "neutral",
      isCurrency: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {allKPIs.map((kpi) => (
        <div
          key={kpi.title}
          className="grid min-h-18 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3 sm:px-4"
        >
          <div
            className={cn(
              "grid size-7 place-items-center rounded-lg sm:size-9",
              METRIC_TONES[kpi.tone],
            )}
          >
            <kpi.Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p
              className={cn(
                "text-xl font-semibold leading-none text-foreground",
                kpi.isCurrency ? "font-mono tabular-nums" : "font-heading",
              )}
            >
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
