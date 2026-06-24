import { TradieManagementClient } from "@/components/tradie-management/tradie-management-client";
import {
  fetchTradieKPIDataCached,
  getTradieGroupedByCategoryCached,
} from "@/lib/data/tradie-management";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tradie Management",
  description: "Manage your tradies effectively for seamless project execution.",
};

export default async function TradieManagementPage() {
  const [tradies, kpiData] = await Promise.all([
    getTradieGroupedByCategoryCached(),
    fetchTradieKPIDataCached(),
  ]);

  return <TradieManagementClient tradies={tradies} tradieKPIData={kpiData} />;
}
