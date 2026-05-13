
import { TradiesClient } from "@/components/tradies/tradies-client";
import { getCachedTradieScheduleKPIs, getCachedTradieSchedules, getCachedTradies } from "@/lib/data/tradies";

export default async function TradiePage() {
  const [tradies, schedules, kpis] = await Promise.all([
    getCachedTradies(),
    getCachedTradieSchedules(),
    getCachedTradieScheduleKPIs(),
  ]);

  return <TradiesClient tradies={tradies} schedules={schedules} kpis={kpis} />;
}
