import { cn } from "@/lib/utils";
import { MOBILE_METRIC_STRIP_CLASS } from "@/components/common/metric-card";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function TradieManagementSkeleton() {
  return (
    <PageSkeleton label="Loading tradies" className="space-y-6">
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-1 h-5 w-96 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-28" />
        </div>
      </div>
      <div
        className={cn(
          MOBILE_METRIC_STRIP_CLASS,
          "overflow-hidden sm:grid-cols-3",
        )}
      >
        {Array.from({ length: 3 }, (_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-44" />
        <Skeleton className="h-11 w-full sm:w-64" />
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-11 w-28" />
      </div>
      <DataTableSkeleton columnCount={7} />
    </PageSkeleton>
  );
}
