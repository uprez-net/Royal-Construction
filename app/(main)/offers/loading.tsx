import { OFFER_TABLE_HEADERS } from "@/components/offers/offer-table-columns";
import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function OfferPageSkeleton() {
  return (
    <PageSkeleton label="Loading offers" className="space-y-6">
      {/* Card padding and the mobile action row match PageHeroCard. */}
      <div className="relative overflow-hidden rounded-lg border border-royal-gold/20 bg-linear-to-br from-royal-gold-light to-card px-4 py-8 shadow-sm sm:px-6 sm:py-10">
        <div className="pointer-events-none absolute -right-12 -top-10 size-40 rounded-full bg-royal-gold/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Skeleton className="h-7 w-56 max-w-full bg-royal-gold/15" />
            <Skeleton className="h-10 w-80 max-w-full bg-royal-gold/15 sm:h-5" />
          </div>
          <div className="w-full sm:w-auto">
            <Skeleton className="h-11 w-52 rounded-lg bg-royal-gold/20 sm:h-9" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>

      <div className="rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-4 border-b px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-20 rounded-md sm:h-9" />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-10 w-full max-w-70 rounded-lg" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-4">
          <DataTableSkeleton columnCount={OFFER_TABLE_HEADERS.length} />

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
