import { QuoteFilter } from "@/components/quotes/quote-filter";
import { QuoteHeader } from "@/components/quotes/quote-header";
import { QuoteKPI } from "@/components/quotes/quote-kpi";
import { QuoteTable } from "@/components/quotes/quote-table";
import { Card } from "@/components/ui/card";
import { getQuoteKPIsCached, getQuotesCached } from "@/lib/data/quotes";

export default async function QuotationsPage() {
  const [quoteKPIs, quotes] = await Promise.all([
    getQuoteKPIsCached(),
    getQuotesCached(1, 10),
  ]);

  return (
    <div className="space-y-6">
      <QuoteHeader />
      <QuoteKPI
        activeQuotes={{
          total: quoteKPIs.allQuotes.total,
          trendDelta: quoteKPIs.allQuotes.trendDelta,
        }}
        approvedQuotes={{
          total: quoteKPIs.approvedQuotes.total,
          trendDelta: quoteKPIs.approvedQuotes.trendDelta,
        }}
        pendingQuotes={{
          total: quoteKPIs.pendingQuotes.total,
          trendDelta: quoteKPIs.pendingQuotes.trendDelta,
        }}
        activeVariationQuotes={{
          total: quoteKPIs.sentQuotes.total,
          trendDelta: quoteKPIs.sentQuotes.trendDelta,
        }}
      />
      <Card className="border-border/70 bg-white/95 shadow-sm">
        <QuoteFilter
          initialTabCounts={{
            all: quoteKPIs.allQuotes.total,
            pending: quoteKPIs.pendingQuotes.total,
            approved: quoteKPIs.approvedQuotes.total,
            rejected: quoteKPIs.rejectedQuotes.total,
            sent: quoteKPIs.sentQuotes.total,
          }}
          initialTotalCount={quoteKPIs.allQuotes.total}
        />
        <QuoteTable serverQuotes={quotes} />
      </Card>
    </div>
  );
}
