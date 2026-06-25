import { TradieApprovalActionType, TradieApprovalStatus } from "@prisma/client";
import { SafeTradieApproval } from "./tradie";


export interface PaginatedTradieApprovals {
    approvals: SafeTradieApproval[];
    totalCount: number;
    page: number;
    pageSize: number;
}

export interface TradieApprovalQuery {
    search?: string;
    type?: TradieApprovalActionType;
    status?: TradieApprovalStatus;
    page: number;
    pageSize: number;
}

export interface ApprovalKPI {
    pendingCount: number;
    priceChangeCount: number;
    incidentReportCount: number;
    deletionCount: number;
    scheduleCount: number;
    resolvedCount: {
        accepted: number;
        rejected: number;
    }
}

export type TabKey =
    | "all"
    | "pending"
    | "price"
    | "incident"
    | "delete"
    | "schedule"
    | "approved"
    | "rejected";