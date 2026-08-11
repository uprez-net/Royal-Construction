"use client";
import { TriangleAlert, Star, Users } from "lucide-react";
import { KPIListItem, MetricCard } from "../common/metric-card";
import { useAppSelector } from "@/lib/store/hooks";

export function TradieKPI() {
  const { kpiData } = useAppSelector((state) => state.tradieManagement);
  const allKPIs: KPIListItem[] = [
    {
      title: "Registered tradies",
      dataPoint: kpiData.registeredTradies,
      Icon: Users,
      tone: "primary",
    },
    {
      title: "Incidents lodged",
      dataPoint: kpiData.incidentLodged,
      Icon: TriangleAlert,
      tone: "danger",
      isInverse: true,
    },
    {
      title: "Favourite tradies",
      dataPoint: kpiData.favouriteTradies,
      Icon: Star,
      tone: "accent",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {allKPIs.map((kpi) => (
        <MetricCard
          key={kpi.title}
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
