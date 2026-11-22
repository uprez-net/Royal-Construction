import { TradieManagementClient } from "@/components/tradie-management/tradie-management-client";
import {
  fetchTradieKPIData,
  getTradieGroupedByCategory,
} from "@/lib/data/tradie-management";
import { connection } from "next/server";
import { Metadata } from "next";
import { currentPrincipal } from "@/lib/data/current-principal";
import { canSeeProjectFinancials } from "@/lib/domain/access/projects";
import { withoutTradieQuotes } from "@/lib/domain/projects/financial-redaction";

export const metadata: Metadata = {
  title: "Tradie Management",
  description:
    "Manage your tradies effectively for seamless project execution.",
};

export default async function TradieManagementPage() {
  // Render on demand, never at build. See app/(main)/projects/page.tsx -- the
  // `'use cache'` fetchers get prefilled during `next build` (DB at build time)
  // and take the build down when CI can't reach the DB. Read the UNCACHED
  // fetchers so the query runs at request time, and `connection()` to keep this
  // page's render off the build.
  await connection();
  const [tradies, kpiData, principal] = await Promise.all([
    getTradieGroupedByCategory(),
    fetchTradieKPIData(),
    currentPrincipal(),
  ]);

  // Each row carries the tradie's last quoted price; a site manager does not
  // see tradie prices (`canSeeProjectFinancials`). The KPIs are counts only.
  // `isOffice` also gates the directory writes and the export, which are the
  // office's (a site manager records site work, not tradie commercials).
  const isOffice = canSeeProjectFinancials(principal);
  return (
    <TradieManagementClient
      tradies={isOffice ? tradies : withoutTradieQuotes(tradies)}
      tradieKPIData={kpiData}
      isOffice={isOffice}
    />
  );
}
