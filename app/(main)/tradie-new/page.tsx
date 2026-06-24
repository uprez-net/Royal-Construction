
import { TradiesClient } from "@/components/tradies/tradies-client";
import { TradiesClientNew } from "@/components/tradies/tradies-client-new";
import { getCachedTradieCoordinationDashboard, getCachedTradies } from "@/lib/data/tradies";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tradie Scheduling & Coordination",
  description: "Manage and coordinate your tradies effectively for seamless project execution.",
};

export default async function TradiePage() {
  const [tradies, coordination] = await Promise.all([
    getCachedTradies(),
    getCachedTradieCoordinationDashboard({ page: 1, limit: 10 }),
  ]);

  return <TradiesClientNew initialTradies={tradies} initialDashboard={coordination} />;
}
