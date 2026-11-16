import { cn } from "@/lib/utils";
import {
  KpiBand,
  MOBILE_METRIC_STRIP_CLASS,
} from "@/components/common/kpi-band";
import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import {
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function ApprovalDashboardSkeleton() {
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
        <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:ring-inset [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-border">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div className="flex w-full min-w-0 items-center gap-4 sm:w-auto">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-48 max-w-full" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </TableCard>
    </PageSkeleton>
  );
}
