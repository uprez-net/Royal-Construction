import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <PageSkeleton label="Loading projects" className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card py-4 shadow-sm">
        <div className="space-y-3 border-b border-border/70 px-6 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-96" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-11 w-24 sm:h-8" />
              <Skeleton className="h-11 w-32 sm:h-9" />
            </div>
          </div>
        </div>
        <div className="space-y-4 px-6 pt-5">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-24 rounded-full" />
            ))}
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:justify-between">
            <Skeleton className="h-11 w-full md:max-w-xs" />
            <Skeleton className="h-11 w-28" />
          </div>
          <DataTableSkeleton columnCount={7} />
          <Skeleton className="mx-auto h-11 w-60" />
        </div>
      </div>
    </PageSkeleton>
  );
}
