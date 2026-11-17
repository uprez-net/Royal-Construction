import type { TradieApprovalActionType } from "@prisma/client";
import type { SafeTradieApproval } from "./tradie";

export interface PaginatedTradieApprovals {
  approvals: SafeTradieApproval[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * "needs-decision" is PENDING requests, ordered by when each must be decided.
 * "decided" is APPROVED or REJECTED requests, most recently decided first.
 */
export type ApprovalView = "needs-decision" | "decided";

export interface TradieApprovalQuery {
  view: ApprovalView;
  type?: TradieApprovalActionType;
  /** Only in needs-decision: booking-based requests due by Sydney today + 7. */
  due?: "week";
  search?: string;
  page: number;
  pageSize: number;
}

export interface ApprovalKPI {
  /** PENDING */
  waiting: number;
  /** APPROVED + REJECTED */
  decided: number;
  /** Pending, booking-based, decisionDue on or before Sydney today + 7 (overdue included). */
  dueThisWeek: number;
  /** The oldest pending request, with its age in Sydney calendar days. */
  oldestWaiting: {
    approvalId: string;
    actionType: TradieApprovalActionType;
    days: number;
  } | null;
  waitingByType: Record<TradieApprovalActionType, number>;
  decidedByType: Record<TradieApprovalActionType, number>;
}
