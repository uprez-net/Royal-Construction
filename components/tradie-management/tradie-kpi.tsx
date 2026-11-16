"use client";
import { KpiBand, MOBILE_METRIC_STRIP_CLASS } from "../common/kpi-band";
import { KPIListItem, MetricCard } from "../common/metric-card";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/lib/store/hooks";

export function TradieKPI() {
  const { kpiData } = useAppSelector((state) => state.tradieManagement);
  const allKPIs: KPIListItem[] = [
    {
      title: "Registered tradies",
      dataPoint: kpiData.registeredTradies,
    },
    {
      title: "Incidents lodged",
      dataPoint: kpiData.incidentLodged,
      isInverse: true,
    },
    {
      title: "Favourite tradies",
      dataPoint: kpiData.favouriteTradies,
    },
  ];

  return (
    // Three across as soon as there is room. Going 1 → 2 → 3 columns left the
    // third card alone on a half-empty row at every width between the md and
    // xl breakpoints, which covers most laptop windows.
    <KpiBand className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-3")}>
      {allKPIs.map((kpi) => (
        <MetricCard
          key={kpi.title}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          isInverse={kpi.isInverse}
        />
      ))}
    </KpiBand>
  );
}
