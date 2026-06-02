"use client";
import { PaginatedQuotesResult, QuoteStatusLabels } from "@/types/quote";
import { CardContent } from "../ui/card";
import { currency, dateFormat } from "@/utils/formatters";
import { DataTable } from "../common/data-table";
import { QuotePagination } from "./quote-pagination";
import { ReceiptText, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { useEffect, useMemo } from "react";
import { fetchQuotes, setQuotes } from "@/lib/store/slices/quotesSlice";
import { toast } from "sonner";

export function QuoteTable({
  serverQuotes,
}: {
  serverQuotes: PaginatedQuotesResult;
}) {
  const dispatch = useAppDispatch();
  const { quotes: stateQuotes, loading } = useAppSelector(
    (state) => state.quotes,
  );
  const quotes = useMemo(() => {
    if (stateQuotes.items.length === 0) {
      return serverQuotes;
    }
    return stateQuotes;
  }, [stateQuotes]);

  useEffect(() => {
    dispatch(setQuotes(serverQuotes));
  }, [quotes]);

  const handlePageChange = async (page: number) => {
    try {
      await dispatch(fetchQuotes({ page, limit: quotes.limit })).unwrap();
    } catch (error) {
      console.error("Error fetching quotes for page", page, error);
      toast.error("Failed to load quotes for page " + page);
    }
  };

  return (
    <CardContent className="px-5 py-4">
      <DataTable
        headers={[
          "Quote #",
          "Client",
          "Type",
          "Amount (Ex GST)",
          "GST",
          "Total",
          "Sent At",
          "Approved At",
          "Status",
        ]}
        rows={quotes.items.map((row, index) => [
          `QT-${index + 1}`,
          row.lead?.name || "N/A",
          row.lead.type.length > 0 ? row.lead.type.join(", ") : "-",
          currency.format(parseFloat(row.amount)),
          currency.format(parseFloat(row.gstAmount)),
          currency.format(parseFloat(row.totalAmount)),
          row.sentAt ? dateFormat.format(row.sentAt) : "-",
          row.acceptedAt ? dateFormat.format(row.acceptedAt) : "-",
          QuoteStatusLabels[row.quoteStatus],
        ])}
        emptyState={
          loading ? (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <RefreshCw className="animate-spin size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Loading quotations...
                </p>

                <p className="text-xs text-muted-foreground">
                  Your quotations will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <ReceiptText className="size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No quotations available
                </p>

                <p className="text-xs text-muted-foreground">
                  Your quotations will appear here.
                </p>
              </div>
            </div>
          )
        }
      />
      <QuotePagination quotes={quotes} onPageChange={handlePageChange} />
    </CardContent>
  );
}
