import type { TradiePriceUnit } from "@prisma/client";

import type { SafeTradie } from "./project";
import type { TradieRating, TradieIncident, IncidentSeverity, TradieApprovalActionType, TradieApproval } from "@prisma/client";
import { TradieScheduleStatus } from "@prisma/client";

export interface TradieRow {
    id: string;
    name: string;
    trade: string;
    isFavourite: boolean;
    lastQuotedPrice: string | null;
    lastQuotedPriceUnit: TradiePriceUnit;
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
    // Matches the column. `createTradie` passes this object straight to
    // `prisma.tradie.create({ data: input })`, so a field the schema does not
    // have is an unknown-argument failure at runtime — and because `data`
    // receives a variable rather than an object literal, TypeScript performs
    // no excess-property check and the build stays green.
    lastQuotedPrice: number;
    lastQuotedPriceUnit: TradiePriceUnit;
    abn: string;
    phone: string;
    email: string;
    additionalEmails?: string[];
    location: string;
    note?: string;
}

export interface UpdatePriceInput {
    tradieId: string;
    newHourlyRate: number;
    /** The basis the new amount is quoted on. Optional so an older pending
     *  approval, raised before the basis was captured, still applies against
     *  whatever the tradie is currently set to. */
    newPriceUnit?: TradiePriceUnit;
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

export interface DeleteScheduleInput {
    scheduleId: string;
    reason: string;
}

export interface TradieTableQuery {
    search?: string;
    category?: string;
    rating?: number;
    favourite?: boolean;
    tab: "all" | "flagged";
}

/**
 * The two ways the tradie directory can be shown: trade-category tiles, or the
 * flat list of every tradie. "list" is the tabular view — it was labelled
 * "Table" beside a second, card-based "List" view that showed the same tradies
 * with fewer columns, so the pair read as two names for one thing. The cards
 * went and the table kept the name the team uses.
 */
export type TradieViewTab = "category" | "list";

export interface UpdatePriceApprovalPayload {
    newHourlyRate: number;
    newPriceUnit?: TradiePriceUnit;
}

export interface IncidentReportApprovalPayload {
    resolution: string;
}

export interface ApprovalInput {
    approvalId: string;
    resolution: "approved" | "rejected";
    type: TradieApprovalActionType;
    payload?: UpdatePriceApprovalPayload | IncidentReportApprovalPayload;
    rejectReason?: string;
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

/**
 * Recorded on a SCHEDULE_DELETION approval so the admin queue can describe the
 * booking being removed without holding a reference to a row that is about to
 * disappear, and so the resolver knows which schedule to delete.
 */
export interface ScheduleDeletionJsonPayload {
    scheduleId: string;
    projectId: string;
    projectName: string;
    milestoneId?: string;
    milestoneName: string;
    scheduledDate: string;
    durationDays: number;
    cost: string;
    /** The status the schedule sat in when removal was requested. */
    currentStatus: TradieScheduleStatus;
}

export interface PriceUpdateJsonPayload {
    newHourlyRate: number;
    newPriceUnit?: TradiePriceUnit;
}

export interface IncidentReportJsonPayload {
    incidentId: string;
    incidentType: string;
    incidentSeverity: IncidentSeverity;
    incidentDescription: string;
}

export type TradieApprovalPayload = ScheduleApprovalJsonPayload | ScheduleDeletionJsonPayload | PriceUpdateJsonPayload | IncidentReportJsonPayload | undefined;

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
    [TradieScheduleStatus.DECLINED]: [
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        TradieScheduleStatus.PENDING_RESPONSE,
        TradieScheduleStatus.NO_RESPONSE,
    ],
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