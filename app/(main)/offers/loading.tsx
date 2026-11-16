import { KpiBand } from "@/components/common/kpi-band";
import { Card, CardContent } from "@/components/ui/card";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { OFFER_TABLE_HEADERS } from "@/components/offers/offer-table-columns";
import { cn } from "@/lib/utils";
import {
  FLUSH_TABLE_CARD_CLASS,
  FLUSH_TABLE_CONTENT_CLASS,
} from "@/components/ui/table-styles";
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

      {/* Same flat card as the real table: the header strip and the table share it, flush from md up. */}
      <Card
        className={cn(
          "border-border/70 bg-card/95 shadow-sm",
          FLUSH_TABLE_CARD_CLASS,
          "md:pt-0",
        )}
      >
        <div className="space-y-4 border-b border-border/70 px-5 py-4">
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

        <CardContent className={cn("px-5 py-4", FLUSH_TABLE_CONTENT_CLASS)}>
          <DataTableSkeleton columnCount={OFFER_TABLE_HEADERS.length} flush />

          <div className="mt-6 flex flex-col items-center gap-4 md:pb-4">
            <Skeleton className="h-4 w-36" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </CardContent>
      </Card>
    </PageSkeleton>
  );
}
