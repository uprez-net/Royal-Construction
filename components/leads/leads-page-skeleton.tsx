import {
  KpiBand,
  MOBILE_METRIC_STRIP_CLASS,
} from "@/components/common/kpi-band";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { cn } from "@/lib/utils";
import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export function LeadsContentSkeleton() {
  return (
    <PageSkeleton label="Loading leads" className="space-y-6">
      <KpiBand
        className={cn(
          MOBILE_METRIC_STRIP_CLASS,
          "sm:grid-cols-2 md:grid-cols-3",
        )}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <MetricCardSkeleton key={index} foot />
        ))}
      </KpiBand>

      <div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="h-11 w-24 rounded-md" />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Skeleton className="h-11 w-full rounded-lg sm:order-2 sm:w-48" />
            <Skeleton className="h-11 flex-1 rounded-full sm:order-1 sm:w-32 sm:flex-none" />
            <Skeleton className="h-11 w-24 rounded-md sm:order-3" />
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-lg bg-card shadow-sm">
          <LeadsTableSkeleton />
        </div>
      </div>
    </PageSkeleton>
  );
}

function LeadsTableSkeleton() {
  return (
    <div className="p-4 sm:p-5">
      <DataTableSkeleton columnCount={8} rowCount={5} />
    </div>
  );
}

export function LeadsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-1 h-5 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-36 rounded-md" />
          <Skeleton className="h-11 w-40 rounded-md" />
        </div>
      </div>
      <LeadsContentSkeleton />
    </div>
  );
}

export default LeadsPageSkeleton;
