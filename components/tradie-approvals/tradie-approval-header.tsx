"use client";
import {
  Clock7Icon,
  Tag,
  AlertTriangle,
  Trash2,
  CalendarDays,
  CheckCircle,
} from "lucide-react";
import { KPIListItem, MetricCard } from "../common/metric-card";
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
      iconTone: "bg-yellow-600",
    },
    {
      title: "Price Changes",
      dataPoint: {
        total: kpiData.priceChangeCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: Tag,
      iconTone: "bg-blue-600",
      isInverse: true,
    },
    {
      title: "Incident",
      dataPoint: {
        total: kpiData.incidentReportCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: AlertTriangle,
      iconTone: "bg-red-600",
    },
    {
      title: "Deletions",
      dataPoint: {
        total: kpiData.deletionCount,
        trendDelta: 0, // Placeholder for trend delta calculation
      },
      Icon: Trash2,
      iconTone: "bg-amber-600",
    },
    {
        title: "Scheduling",
        dataPoint: {
          total: kpiData.scheduleCount,
          trendDelta: 0, // Placeholder for trend delta calculation
        },
        Icon: CalendarDays,
        iconTone: "bg-purple-600",
    },
    {
        title: "Resolved Approvals",
        dataPoint: {
          total: kpiData.resolvedCount.accepted + kpiData.resolvedCount.rejected,
          trendDelta: 0, // Placeholder for trend delta calculation
        },
        Icon: CheckCircle,
        iconTone: "bg-green-600",
    }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      {allKPIs.map((kpi, index) => (
        <MetricCard
          key={index}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          Icon={kpi.Icon}
          iconTone={kpi.iconTone}
          isInverse={kpi.isInverse}
        />
      ))}
    </div>
  );
}
