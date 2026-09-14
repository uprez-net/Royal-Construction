import { OFFER_TABLE_HEADERS } from "@/components/offers/offer-table-columns";
import { MetricCardSkeleton, PageSkeleton, Skeleton } from "@/components/ui/skeleton";

// One skeleton column per real column, from the table's own list. A hard-coded
// ten drifted from the eleven the table renders.
const tableGrid = {
  gridTemplateColumns: `repeat(${OFFER_TABLE_HEADERS.length}, minmax(0, 1fr))`,
};

export default function OfferPageSkeleton() {
  return (
    <PageSkeleton label="Loading offers" className="space-y-6">
      <div className="rounded-lg border border-royal-gold/30 bg-royal-gold-light/60 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56 bg-royal-gold/15" />
            <Skeleton className="h-4 w-80 max-w-full bg-royal-gold/15" />
          </div>
          <Skeleton className="h-8 w-48 rounded-lg bg-royal-gold/20" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>

      <div className="rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-4 border-b px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-20 rounded-md" />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-10 w-full max-w-70 rounded-lg" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-4">
          <div className="min-w-180 overflow-hidden rounded-lg border">
            <div
              className="grid gap-4 border-b bg-muted/40 px-4 py-4"
              style={tableGrid}
            >
              {OFFER_TABLE_HEADERS.map((header) => (
                <Skeleton key={header.label} className="h-4 w-full max-w-20" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="grid gap-4 border-b px-4 py-5 last:border-0"
                style={tableGrid}
              >
                {OFFER_TABLE_HEADERS.map((header) => (
                  <Skeleton key={header.label} className="h-4 w-full max-w-24" />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-4">
            <Skeleton className="h-4 w-36" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
