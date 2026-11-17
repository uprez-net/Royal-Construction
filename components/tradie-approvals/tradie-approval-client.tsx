"use client";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  approvalErrorMessage,
  approvalOutcomeMessage,
  approveInput,
  approveRequests,
  cancelsBookings,
  clearState,
  needsReviewWindow,
  fetchApprovalsByQuery,
  setApprovalData,
  setKPIData,
  setQuery,
} from "@/lib/store/slices/tradieApprovalSlice";
import {
  ApprovalKPI,
  PaginatedTradieApprovals,
  TradieApprovalQuery,
} from "@/types/tradie-approvals";
import { SafeTradieApproval } from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieApprovalKPI } from "./tradie-approval-header";
import {
  TradieApprovalTabs,
  TradieApprovalTypeFilters,
} from "./tradie-approval-tabs";
import { TableCard } from "@/components/common/list-toolbar";
import { TradieApprovalPagination } from "./tradie-approval-pagination";
import { TradieApprovalList } from "./tradie-approval-list";
import { ApproveConfirmDialog } from "./modal/approve-confirm-dialog";
import { useSearchParams } from "next/navigation";

interface TradieApprovalClientProps {
  kpiData: ApprovalKPI;
  approvalsData: PaginatedTradieApprovals;
}

const APPROVAL_TYPES: string[] = Object.values(TradieApprovalActionType);

export function TradieApprovalClient({
  kpiData,
  approvalsData,
}: TradieApprovalClientProps) {
  const dispatch = useAppDispatch();
  const searchParams = useSearchParams();
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const approvalType = searchParams.get("approvalType");
  const [processingIds, setProcessingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [confirming, setConfirming] = useState<SafeTradieApproval[]>([]);
  const query = useAppSelector((state) => state.tradieApproval.query);
  // The server props seed the store once, on mount. A later server render
  // (router.refresh, revalidation) must not reset the view the user chose; the
  // slice reloads the list and counts itself after each decision.
  const [seed] = useState(() => ({ kpiData, approvalsData }));

  useEffect(() => {
    dispatch(setKPIData(seed.kpiData));
    dispatch(setApprovalData(seed.approvalsData));

    return () => {
      dispatch(clearState());
    };
  }, [seed, dispatch]);

  // The one place the list is fetched: every view, chip, figure, search and
  // page change lands in `query`, and the rows follow it.
  useEffect(() => {
    dispatch(fetchApprovalsByQuery(query));
  }, [query, dispatch]);

  // Notification links: status=PENDING|APPROVED|REJECTED and approvalType.
  // An unknown approvalType is dropped, not sent to the query.
  useEffect(() => {
    if (!q && !status && !approvalType) return;
    const updates: Partial<TradieApprovalQuery> = {
      page: 1,
      view:
        status === "APPROVED" || status === "REJECTED"
          ? "decided"
          : "needs-decision",
    };
    if (q) updates.search = q;
    if (approvalType && APPROVAL_TYPES.includes(approvalType)) {
      updates.type = approvalType as TradieApprovalActionType;
    }
    dispatch(setQuery(updates));
  }, [q, status, approvalType, dispatch]);

  const approveNow = async (rows: SafeTradieApproval[]) => {
    const ids = rows.map((row) => row.id);
    setProcessingIds((prev) => new Set([...prev, ...ids]));
    try {
      const result = await dispatch(
        approveRequests(rows.map(approveInput)),
      ).unwrap();
      const message = approvalOutcomeMessage(result, "approved");
      if (message.success) toast.success(message.success);
      if (message.failure) toast.error(message.failure);
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error(approvalErrorMessage(error));
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  // The one approve path, for the row button and the bulk button. A request
  // that cancels bookings is confirmed first; the rest go straight through.
  const requestApprove = async (selected: SafeTradieApproval[]) => {
    // Incidents (a resolution note) and removals (an impact acknowledgement)
    // are decided in their review window: one opens it; in a batch they are
    // left out and the office is told to open each one.
    const reviewed = selected.filter(needsReviewWindow);
    const rows = selected.filter((row) => !needsReviewWindow(row));
    if (reviewed.length === 1 && rows.length === 0) {
      dispatch(
        openModal({
          type: "adminApproval",
          payload: {
            approvalId: reviewed[0].id,
            approvalType: reviewed[0].actionType,
          },
        }),
      );
      return;
    }
    if (reviewed.length > 0) {
      const one = reviewed.length === 1;
      toast.info(
        `${reviewed.length} ${one ? "request needs its" : "requests need their"} review window (incident resolutions, tradie removals). Open ${one ? "it" : "each one"} to resolve.`,
      );
    }
    if (rows.length === 0) return;
    if (rows.some(cancelsBookings)) {
      setConfirming(rows);
      return;
    }
    await approveNow(rows);
  };

  return (
    <div className="space-y-6">
      <TradieApprovalKPI />
      <TradieApprovalTabs
        onApprove={requestApprove}
        processingIds={processingIds}
      />
      <TableCard header={<TradieApprovalTypeFilters />}>
        <TradieApprovalList
          processingIds={processingIds}
          onApprove={requestApprove}
        />
      </TableCard>
      <TradieApprovalPagination />
      <ApproveConfirmDialog
        requests={confirming}
        onCancel={() => setConfirming([])}
        onConfirm={() => {
          const rows = confirming;
          setConfirming([]);
          void approveNow(rows);
        }}
      />
    </div>
  );
}
