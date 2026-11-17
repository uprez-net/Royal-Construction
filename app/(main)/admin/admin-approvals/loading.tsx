import { cn } from "@/lib/utils";
import {
  KpiBand,
  MOBILE_METRIC_STRIP_CLASS,
} from "@/components/common/kpi-band";
import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

/** Everything under the page header: the page streams this part. */
export function ApprovalBodySkeleton() {
  return (
    <PageSkeleton label="Loading approvals" className="space-y-6">
      <KpiBand
        className={cn(
          MOBILE_METRIC_STRIP_CLASS,
          "sm:grid-cols-2 xl:grid-cols-7",
        )}
      >
        {Array.from({ length: 7 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </KpiBand>

      <ListToolbar
        start={
          <div className="hidden flex-wrap items-center gap-1.5 md:flex">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-24 rounded-md" />
            ))}
          </div>
        }
      >
        <Skeleton className="h-11 w-full rounded-lg sm:w-55" />
      </ListToolbar>

      <TableCard
        header={
          <>
            <div className="space-y-1.5 md:hidden">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
            <div className="hidden flex-wrap items-center gap-1 md:flex">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-28 rounded-lg" />
              ))}
            </div>
          </>
        }
      >
        <DataTableSkeleton columnCount={8} flush />
      </TableCard>
    </PageSkeleton>
  );
}

/** The route-level state: the page header, then the body. */
export default function ApprovalDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <ApprovalBodySkeleton />
    </div>
  );
}
