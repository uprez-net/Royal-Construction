
import { TradiesClient } from "../../../components/tradies/tradies-client";
import { getCachedTradieCoordinationDashboard, getCachedTradies } from "../../../lib/data/tradies";

export default async function TradiePage() {
  const [tradies, coordination] = await Promise.all([
    getCachedTradies(),
    getCachedTradieCoordinationDashboard({ page: 1, limit: 10 }),
  ]);

  return <TradiesClient initialTradies={tradies} initialDashboard={coordination} />;
}
