import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
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
      {/* Same layout and title height as PageHeader, so the swap does not jump. */}
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="mt-1 h-10 w-96 max-w-full sm:h-5" />
        </div>
        <div className="w-full sm:w-auto">
          <Skeleton className="h-11 w-52 rounded-lg sm:h-9" />
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
