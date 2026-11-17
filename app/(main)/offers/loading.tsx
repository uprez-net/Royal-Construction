import { KpiBand } from "@/components/common/kpi-band";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import { OFFER_TABLE_HEADERS } from "@/components/offers/offer-table-columns";
import { cn } from "@/lib/utils";
import { FLUSH_TABLE_CONTENT_CLASS } from "@/components/ui/table-styles";
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

      <KpiBand className="grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} foot />
        ))}
      </KpiBand>

      {/* The toolbar sits on the page, as in OfferFilter; the card below is the one TableCard. */}
      <div className="space-y-5">
        <ListToolbar start={<Skeleton className="h-4 w-20" />}>
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="order-first h-11 w-full rounded-lg sm:order-none sm:w-55" />
        </ListToolbar>

        <TableCard
          header={
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
              <div className="flex flex-col gap-1.5 md:hidden">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
              <div className="hidden gap-1 md:flex">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-20 rounded-md" />
                ))}
              </div>
            </div>
          }
        >
          <div className={cn("px-4 py-4 sm:px-5", FLUSH_TABLE_CONTENT_CLASS)}>
            <DataTableSkeleton columnCount={OFFER_TABLE_HEADERS.length} flush />

            <div className="mt-6 flex flex-col items-center gap-4 md:pb-4">
              <Skeleton className="h-4 w-36" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        </TableCard>
      </div>
    </PageSkeleton>
  );
}
