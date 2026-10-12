"use client";
import { TriangleAlert, Star, Users } from "lucide-react";
import {
  KPIListItem,
  MetricCard,
  MOBILE_METRIC_STRIP_CLASS,
} from "../common/metric-card";
import { cn } from "@/lib/utils";
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
    // Three across as soon as there is room. Going 1 → 2 → 3 columns left the
    // third card alone on a half-empty row at every width between the md and
    // xl breakpoints, which covers most laptop windows.
    <div className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-3")}>
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
