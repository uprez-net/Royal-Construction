import { cn } from "@/lib/utils";
import {
  KpiBand,
  MOBILE_METRIC_STRIP_CLASS,
} from "@/components/common/kpi-band";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
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
      <KpiBand className={cn(MOBILE_METRIC_STRIP_CLASS, "sm:grid-cols-3")}>
        {Array.from({ length: 3 }, (_, i) => (
          <MetricCardSkeleton key={i} foot />
        ))}
      </KpiBand>
      <ListToolbar
        start={
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-11 w-24 rounded-md" />
            <Skeleton className="h-11 w-20 rounded-md" />
          </div>
        }
      >
        <Skeleton className="h-11 w-36 rounded-lg" />
        <Skeleton className="h-11 w-36 rounded-lg" />
        <Skeleton className="h-11 w-28 rounded-md" />
        <Skeleton className="h-11 w-full rounded-lg sm:w-55" />
      </ListToolbar>
      <TableCard
        header={
          <div className="flex gap-1">
            <Skeleton className="h-11 w-28 rounded-lg" />
            <Skeleton className="h-11 w-24 rounded-lg" />
          </div>
        }
      >
        <div className="p-4 sm:p-5 md:p-0">
          <DataTableSkeleton columnCount={7} flush />
        </div>
      </TableCard>
    </PageSkeleton>
  );
}
