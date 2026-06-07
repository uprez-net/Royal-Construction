import type { Offer, Lead, OfferItem, OfferStatus } from "@prisma/client";

export interface SafeOfferItem extends Omit<OfferItem, 'unitPrice' | 'totalPrice'> {
    unitPrice: string;
    totalPrice: string;
}

export interface SafeOffer extends Omit<Offer, 'amount' | 'gstAmount' | 'totalAmount'> {
    amount: string;
    gstAmount: string;
    totalAmount: string;
}

export interface OfferWithLead extends SafeOffer {
    lead: Lead
}

export interface OfferWithItems extends OfferWithLead {
    items: SafeOfferItem[];
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
    SENT: "Sent"
};