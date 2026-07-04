"use client";
import { TriangleAlert, Star, Users } from "lucide-react";
import { KPIListItem, MetricCard } from "../common/metric-card";
import { useAppSelector } from "@/lib/store/hooks";

export function TradieKPI() {
  const { kpiData } = useAppSelector((state) => state.tradieManagement);
  const allKPIs: KPIListItem[] = [
    {
      title: "Registered Tradies",
      dataPoint: kpiData.registeredTradies,
      Icon: Users,
      iconTone: "bg-teal-600",
    },
    {
      title: "Incidents Lodged",
      dataPoint: kpiData.incidentLodged,
      Icon: TriangleAlert,
      iconTone: "bg-red-600",
      isInverse: true,
    },
    {
      title: "Favourite Tradies",
      dataPoint: kpiData.favouriteTradies,
      Icon: Star,
      iconTone: "bg-orange-600",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
