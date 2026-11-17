import { KpiBand } from "@/components/common/kpi-band";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import {
  TableCard,
  TOOLBAR_BUTTON_CLASS,
} from "@/components/common/list-toolbar";
import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function ProjectsLoading() {
  return (
    <PageSkeleton label="Loading projects" className="grid gap-6">
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-5 w-96 max-w-full" />
        </div>
      </div>
      <KpiBand className="grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </KpiBand>
      <div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-3">
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
            <Skeleton
              className={cn("h-11 w-20 rounded-lg", TOOLBAR_BUTTON_CLASS)}
            />
            <Skeleton className="order-first h-11 w-full min-w-0 rounded-lg sm:order-none sm:w-55 sm:max-w-60 sm:min-w-45" />
            <Skeleton className="h-11 w-22 rounded-lg" />
            <Skeleton
              className={cn("h-11 w-28 rounded-lg", TOOLBAR_BUTTON_CLASS)}
            />
            <Skeleton
              className={cn("h-11 w-32 rounded-lg", TOOLBAR_BUTTON_CLASS)}
            />
          </div>
        </div>
        <div className="pt-5">
          <TableCard
            header={
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 7 }, (_, i) => (
                  <Skeleton key={i} className="h-11 w-24 rounded-lg" />
                ))}
              </div>
            }
          >
            <div className="p-4 sm:p-5 md:p-0">
              <DataTableSkeleton columnCount={7} flush />
            </div>
          </TableCard>
        </div>
        <div className="space-y-3 pt-2">
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
