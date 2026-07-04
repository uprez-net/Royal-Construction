import { TradieApprovalClient } from "@/components/tradie-approvals/tradie-approval-client";
import {
  fetchApprovalKPICached,
  fetchTradieApprovalsCached,
} from "@/lib/data/tradie-approvals";
import { Metadata } from "next";
import { Suspense } from "react";
import ApprovalDashboardSkeleton from "./loading";

export const metadata: Metadata = {
  title: "Admin Tradie Approvals",
  description: "Admin page for managing tradie approvals",
};

async function AdminApprovalsRender() {
  const kpiData = await fetchApprovalKPICached();
  const approvalsData = await fetchTradieApprovalsCached({
    page: 1,
    pageSize: 10,
  });

  return (
    <TradieApprovalClient kpiData={kpiData} approvalsData={approvalsData} />
  );
}

export default function AdminApprovalsPage() {
  return(
    <Suspense fallback={<ApprovalDashboardSkeleton />}>
      <AdminApprovalsRender />
    </Suspense>
  );
}
