import { TradiesClient } from "@/components/tradies/tradies-client";
import { getTradies } from "@/lib/data/tradies";
import { getTradieCoordinationDashboard } from "@/lib/data/tradie-dashboard";
import { connection } from "next/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tradie Scheduling & Coordination",
  description:
    "Manage and coordinate your tradies effectively for seamless project execution.",
};

export default async function TradiePage() {
  // Render on demand, never at build. See app/(main)/projects/page.tsx -- the
  // `'use cache'` fetchers get prefilled during `next build` (DB at build time)
  // and take the build down when CI can't reach the DB. Read the UNCACHED
  // fetchers so the query runs at request time, and `connection()` to keep this
  // page's render off the build.
  await connection();
  const [tradies, coordination] = await Promise.all([
    getTradies(),
    getTradieCoordinationDashboard({ page: 1, limit: 10 }),
  ]);

  return (
    <TradiesClient initialTradies={tradies} initialDashboard={coordination} />
  );
}
