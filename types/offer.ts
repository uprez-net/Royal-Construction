import type { Offer, Lead, OfferItem, OfferStatus, OfferFile } from "@prisma/client";
import type { OfferFile as OfferFileType } from "@/types/offer-content";

// Progress shape for the offer/tender workflow status stream. Formerly exported
// from lib/workflow/offer.ts (removed with the old AI offer flow); relocated
// here so the kept WorkFlowStatusContext + resume-stream route compile. The
// project tender-extraction stream reuses the same context/route.
export interface OfferCreationStatus {
    failed?: boolean;
    status: "FETCHING_DETAILS" | "BUILDING_OFFER" | "SAVING_OFFER" | "TRIGGERING_NOTIFICATION" | "COMPLETED";
    progress: number;
    message: {
        step: "FETCHING_DETAILS" | "BUILDING_OFFER" | "SAVING_OFFER" | "TRIGGERING_NOTIFICATION" | "COMPLETED";
        details?: string;
    }[];
}

export interface SafeOfferItem extends Omit<OfferItem, 'unitPrice' | 'totalPrice'> {
    unitPrice: string;
    totalPrice: string;
}

export interface SafeOfferDBFile extends Omit<OfferFile, 'offerContent'> {
    offerContent: OfferFileType;
}

export interface SafeOffer extends Omit<Offer, 'amount' | 'gstAmount' | 'totalAmount'> {
    amount: string;
    gstAmount: string;
    totalAmount: string;
    version: number;
}

export interface OfferWithLead extends SafeOffer {
    lead: Lead
}

export interface OfferWithItemsAndFiles extends OfferWithLead {
    items: Record<number, SafeOfferItem[]>;
    files: Record<number, SafeOfferDBFile>;
}

export type PaginatedOfferResult = {
    items:  OfferWithLead[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
}

interface KPIResult {
    total: number;
    trendDelta: number;
}

export interface OfferKPIs {
    allOffers: KPIResult;
    pendingOffers: KPIResult;
    approvedOffers: KPIResult;
    rejectedOffers: KPIResult;
    sentOffers: KPIResult;
}

export const OfferStatusLabels: Record<OfferStatus, string> = {
    PENDING: "Pending",
    ACCEPTED: "Approved",
    REJECTED: "Rejected",
    SENT: "Sent",
    AGREED: "Agreed",
    TENDER_DRAFT: "Tender draft",
    TENDER_SENT: "Tender sent",
    TENDER_SIGNED: "Tender signed",
    TENDER_DECLINED: "Tender declined",
    CONTRACT_DRAFT: "Contract draft",
    CONTRACT_SENT: "Contract sent",
    CONTRACT_SIGNED: "Contract signed",
    CONTRACT_DECLINED: "Contract declined",
    PROJECT: "Project",
    SUPERSEDED: "Superseded",
};