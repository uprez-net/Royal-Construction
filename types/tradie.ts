import type { SafeTradie } from "./project";
import type { TradieRating, TradieIncident, IncidentSeverity, TradieApprovalActionType, TradieApproval } from "@prisma/client";
import { TradieScheduleStatus } from "@prisma/client";

export interface TradieRow {
    id: string;
    name: string;
    trade: string;
    isFavourite: boolean;
    hourlyRate: string | null;
    rating: string | null;
    jobsCompleted: number;
    incidentCount: {
        open: number;
        resolved: number;
    };
}

export interface TradiesByCategory {
    category: string;
    avgRating: number;
    totalCategoryJobsCompleted: number;
    tradies: TradieRow[];
}

export interface ReviewWithUser extends Omit<TradieRating, 'rating'> {
    rating: string;
    user: {
        id: string;
        name: string;
    }
}

export interface TradieDetails extends SafeTradie {
    jobsCompleted: number;
    reviews: ReviewWithUser[];
    incidents: TradieIncident[];
}

export interface CreateTradieInput {
    name: string;
    trade: string;
    hourlyRate: number;
    abn: string;
    phone: string;
    email: string;
    note?: string;
}

export interface UpdatePriceInput {
    tradieId: string;
    newHourlyRate: number;
    reason: string;
}

export interface ReportIncidentInput {
    tradieId: string;
    incidentType: string;
    incidentSeverity: IncidentSeverity;
    incidentDescription: string;
    fileIds?: string[];
}

export interface RatingInput {
    tradieId: string;
    rating: number;
    comment?: string;
}

export interface DeleteInput {
    tradieId: string;
    reason: string;
}

export interface TradieTableQuery {
    search?: string;
    category?: string;
    rating?: number;
    favourite?: boolean;
    tab: "all" | "flagged";
}

export interface UpdatePriceApprovalPayload {
    newHourlyRate: number;
}

export interface IncidentReportApprovalPayload {
    resolution: string;
}

export interface ApprovalInput {
    approvalId: string;
    resolution: "approved" | "rejected";
    type: TradieApprovalActionType;
    payload?: UpdatePriceApprovalPayload | IncidentReportApprovalPayload
}

export interface ScheduleApprovalJsonPayload {
    scheduleId: string;
    projectId: string;
    projectName: string;
    milestoneId?: string;
    milestoneName: string;
    scheduledDate: string;
    durationDays: number;
    cost: string;
}

export interface PriceUpdateJsonPayload {
    newHourlyRate: number;
}

export interface IncidentReportJsonPayload {
    incidentId: string;
    incidentType: string;
    incidentSeverity: IncidentSeverity;
    incidentDescription: string;
}

export type TradieApprovalPayload = ScheduleApprovalJsonPayload | PriceUpdateJsonPayload | IncidentReportJsonPayload | undefined;

export interface SafeTradieApproval extends Omit<TradieApproval, "requestedBy" | "updationData"> {
    tradie: SafeTradie;
    requestBy: string;
    updationData: TradieApprovalPayload;
}

export const TRADIE_SCHEDULE_STATE_MACHINE: Record<TradieScheduleStatus, TradieScheduleStatus[]> = {
    [TradieScheduleStatus.PENDING]: [
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        TradieScheduleStatus.NO_RESPONSE,
        TradieScheduleStatus.PENDING_RESPONSE,
    ],
    [TradieScheduleStatus.AWAITING_ADMIN_APPROVAL]: [
        TradieScheduleStatus.CONFIRMED,
        TradieScheduleStatus.DECLINED,
    ],
    [TradieScheduleStatus.PENDING_RESPONSE]: [
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        TradieScheduleStatus.DECLINED,
    ],
    [TradieScheduleStatus.CONFIRMED]: [
        TradieScheduleStatus.COMPLETED,
        TradieScheduleStatus.DECLINED,
    ],
    [TradieScheduleStatus.NO_RESPONSE]: [
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        TradieScheduleStatus.DECLINED,
    ],
    [TradieScheduleStatus.DECLINED]: [],
    [TradieScheduleStatus.COMPLETED]: [],
    [TradieScheduleStatus.AWAITING_QUOTE]: [
        TradieScheduleStatus.QUOTE_RECEIVED,
        TradieScheduleStatus.DECLINED,
    ],
    [TradieScheduleStatus.QUOTE_RECEIVED]: [
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        TradieScheduleStatus.DECLINED,
    ],
}