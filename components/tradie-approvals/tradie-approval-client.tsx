"use client";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  clearState,
  setActiveTab,
  setApprovalData,
  setKPIData,
  setQuery,
} from "@/lib/store/slices/tradieApprovalSlice";
import {
  ApprovalKPI,
  PaginatedTradieApprovals,
  TabKey,
} from "@/types/tradie-approvals";
import { useEffect } from "react";
import { TradieApprovalKPI } from "./tradie-approval-header";
import { TradieApprovalTabs } from "./tradie-approval-tabs";
import { TradieApprovalPagination } from "./tradie-approval-pagination";
import { TradieApprovalList } from "./tradie-approval-list";
import { useSearchParams } from "next/navigation";
import { TradieApprovalActionType, TradieApprovalStatus } from "@prisma/client";

interface TradieApprovalClientProps {
  kpiData: ApprovalKPI;
  approvalsData: PaginatedTradieApprovals;
}

export function TradieApprovalClient({
  kpiData,
  approvalsData,
}: TradieApprovalClientProps) {
  const dispatch = useAppDispatch();
  const searchParams = useSearchParams();
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const type = searchParams.get("approvalType");

  useEffect(() => {
    dispatch(setKPIData(kpiData));
    dispatch(setApprovalData(approvalsData));

    return () => {
      dispatch(clearState());
    };
  }, [kpiData, approvalsData, dispatch]);

  useEffect(() => {
    if (q || status || type) {
      const decodedQ = q ? decodeURIComponent(q) : undefined;
      dispatch(
        setQuery({
          search: decodedQ,
          status: (status ?? undefined) as TradieApprovalStatus | undefined,
          type: (type ?? undefined) as TradieApprovalActionType | undefined,
        }),
      );
      dispatch(setActiveTab(status ? (status.toLowerCase() as TabKey) : "all"));
    }
  }, [q, status, type, approvalsData, dispatch]);

  return (
    <div className="space-y-6">
      <TradieApprovalKPI />
      <TradieApprovalTabs />
      <TradieApprovalList />
      <TradieApprovalPagination />
    </div>
  );
}
