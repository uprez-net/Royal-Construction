import type { Quote, Lead, QuoteItem, QuoteStatus } from "@prisma/client";

export interface SafeQuoteItem extends Omit<QuoteItem, 'unitPrice' | 'totalPrice'> {
    unitPrice: string;
    totalPrice: string;
}

export interface SafeQuote extends Omit<Quote, 'amount' | 'gstAmount' | 'totalAmount'> {
    amount: string;
    gstAmount: string;
    totalAmount: string;
}

export interface QuoteWithLead extends SafeQuote {
    lead: Lead
}

export interface QuoteWithItems extends QuoteWithLead {
    items: SafeQuoteItem[];
}

export type PaginatedQuotesResult = {
    items:  QuoteWithLead[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
}

interface KPIResult {
    total: number;
    trendDelta: number;
}

export interface QuoteKPIs {
    allQuotes: KPIResult;
    pendingQuotes: KPIResult;
    approvedQuotes: KPIResult;
    rejectedQuotes: KPIResult;
    sentQuotes: KPIResult;
}

export const QuoteStatusLabels: Record<QuoteStatus, string> = {
    PENDING: "Pending",
    ACCEPTED: "Approved",
    REJECTED: "Rejected",
    SENT: "Sent"
};