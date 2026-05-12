import { TradiesClient } from "./tradies-client";
import { getCachedTradieScheduleKPIs, getCachedTradieSchedules, getCachedTradies } from "@/lib/data/tradies";

export async function TradiesScreen({
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [tradies, schedules, kpis] = await Promise.all([
    getCachedTradies(),
    getCachedTradieSchedules(),
    getCachedTradieScheduleKPIs(),
  ]);

  return <TradiesClient tradies={tradies} schedules={schedules} kpis={kpis} />;
}
