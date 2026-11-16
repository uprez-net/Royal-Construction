"use client";
import {
  Clock7Icon,
  Tag,
  AlertTriangle,
  Trash2,
  CalendarDays,
  CalendarX,
  CheckCircle,
} from "lucide-react";
import {
  KPIListItem,
  MetricCard,
  MOBILE_METRIC_STRIP_CLASS,
} from "../common/metric-card";
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
      Icon: Clock7Icon,
      tone: "warning",
    },
    {
      title: "Price Changes",
      dataPoint: {
        total: kpiData.priceChangeCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: Tag,
      tone: "info",
      isInverse: true,
    },
    {
      title: "Incident",
      dataPoint: {
        total: kpiData.incidentReportCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: AlertTriangle,
      tone: "danger",
    },
    {
      title: "Deletions",
      dataPoint: {
        total: kpiData.deletionCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: Trash2,
      tone: "warning",
    },
    {
      title: "Scheduling",
      dataPoint: {
        total: kpiData.scheduleCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: CalendarDays,
      tone: "info",
    },
    {
      title: "Schedule Removals",
      dataPoint: {
        total: kpiData.scheduleDeletionCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: CalendarX,
      tone: "danger",
    },
    {
      title: "Resolved Approvals",
      dataPoint: {
        total: kpiData.resolvedCount.accepted + kpiData.resolvedCount.rejected,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: CheckCircle,
      tone: "success",
    },
  ];

  return (
    <div
      className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-2 xl:grid-cols-7")}
    >
      {allKPIs.map((kpi, index) => (
        <MetricCard
          key={index}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          Icon={kpi.Icon}
          tone={kpi.tone}
          isInverse={kpi.isInverse}
        />
      ))}
    </div>
  );
}
