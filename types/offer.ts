import type { Offer, Lead, OfferItem, OfferStatus, OfferFile } from "@prisma/client";
import type { OfferFile as OfferFileType } from "@/context/ChatContext";

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
    SENT: "Sent"
};