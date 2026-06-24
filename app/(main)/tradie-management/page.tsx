import { TradieManagementClient } from "@/components/tradie-management/tradie-management-client";
import {
  fetchTradieKPIDataCached,
  getTradieGroupedByCategoryCached,
} from "@/lib/data/tradie-management";

export default async function TradieManagementPage() {
  const [tradies, kpiData] = await Promise.all([
    getTradieGroupedByCategoryCached(),
    fetchTradieKPIDataCached(),
  ]);

  return <TradieManagementClient tradies={tradies} tradieKPIData={kpiData} />;
}
