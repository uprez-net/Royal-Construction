import { TradieManagementClient } from "@/components/tradie-management/tradie-management-client";
import {
  fetchTradieKPIData,
  getTradieGroupedByCategory,
} from "@/lib/data/tradie-management";
import { connection } from "next/server";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tradie Management",
  description: "Manage your tradies effectively for seamless project execution.",
};

export default async function TradieManagementPage() {
  // Render on demand, never at build. See app/(main)/projects/page.tsx -- the
  // `'use cache'` fetchers get prefilled during `next build` (DB at build time)
  // and take the build down when CI can't reach the DB. Read the UNCACHED
  // fetchers so the query runs at request time, and `connection()` to keep this
  // page's render off the build.
  await connection();
  const [tradies, kpiData] = await Promise.all([
    getTradieGroupedByCategory(),
    fetchTradieKPIData(),
  ]);

  return <TradieManagementClient tradies={tradies} tradieKPIData={kpiData} />;
}
