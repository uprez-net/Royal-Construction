import { TradieApprovalClient } from "@/components/tradie-approvals/tradie-approval-client";
import {
  fetchApprovalKPI,
  fetchTradieApprovals,
} from "@/lib/data/tradie-approvals";
import { Metadata } from "next";
import { Suspense } from "react";
import ApprovalDashboardSkeleton from "./loading";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Admin Tradie Approvals",
  description: "Admin page for managing tradie approvals",
};

// Read the UNCACHED fetchers, not the `'use cache'` variants. Under Next 16
// Cache Components (cacheComponents: true) a `'use cache'` value is prefilled at
// BUILD time; these functions hit the DB, and a build-time connection timeout
// threw and failed the whole build (`/admin-approvals` prerender error).
// `export const dynamic = "force-dynamic"` is a no-op here (all pages are dynamic
// by default under Cache Components — see the migration guide). The correct fix
// is to defer this admin dashboard's live data to REQUEST time: uncached reads
// inside the existing <Suspense> boundary stream at request instead of
// prerendering, so `next build` only extracts the skeleton shell and never
// touches the DB. Always-fresh approval data is the right behaviour for this
// screen anyway.
async function AdminApprovalsRender() {
  await connection();
  const [kpiData, approvalsData] = await Promise.all([
    fetchApprovalKPI(),
    fetchTradieApprovals({
      page: 1,
      pageSize: 10,
    }),
  ]);

  return (
    <TradieApprovalClient kpiData={kpiData} approvalsData={approvalsData} />
  );
}

export default function AdminApprovalsPage() {
  return (
    <Suspense fallback={<ApprovalDashboardSkeleton />}>
      <AdminApprovalsRender />
    </Suspense>
  );
}
