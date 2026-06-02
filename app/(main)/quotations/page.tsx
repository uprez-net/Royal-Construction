import { DataTable } from "@/components/common/data-table";
import { QuoteFilter } from "@/components/quotes/quote-filter";
import { QuoteHeader } from "@/components/quotes/quote-header";
import { QuoteKPI } from "@/components/quotes/quote-kpi";
import { Card, CardContent } from "@/components/ui/card";
import { quoteRows } from "@/lib/mock-data";
import { ReceiptText } from "lucide-react";

export default function QuotationsPage() {
  return (
    <div className="space-y-6">
      <QuoteHeader />
      <QuoteKPI
        activeQuotes={{ total: 24, trendDelta: 3 }}
        approvedQuotes={{ total: 12, trendDelta: -1 }}
        pendingQuotes={{ total: 5, trendDelta: 2 }}
        activeVariationQuotes={{ total: 7, trendDelta: 1 }}
      />
      <Card className="border-border/70 bg-white/95 shadow-sm">
        <QuoteFilter
          tabCounts={{
            all: 24,
            pending: 5,
            approved: 12,
            rejected: 3,
            sent: 7,
          }}
          totalCount={24}
        />
        <CardContent className="px-5 py-4">
          <DataTable
            headers={["Quote", "Client", "Value", "Status", "Expiry"]}
            rows={quoteRows.map((row) => [
              row.quote,
              row.client,
              row.value,
              row.status,
              row.expiry,
            ])}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <ReceiptText className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No quotations available
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Quotations will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
