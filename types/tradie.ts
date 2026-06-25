import type { SafeTradie } from "./project";
import type { TradieRating, TradieIncident, IncidentSeverity, TradieApprovalActionType, TradieApproval } from "@prisma/client";

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
    notes?: string;
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

export interface SafeTradieApproval extends Omit<TradieApproval, "requestedBy"> {
    tradie: SafeTradie;
    requestBy: string; 
}