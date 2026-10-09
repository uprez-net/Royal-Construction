import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export default function TradieManagementSkeleton() {
  return (
    <PageSkeleton label="Loading tradies" className="space-y-6">
      <div className="rounded-lg border border-border/70 bg-card px-4 py-8 shadow-sm sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-96" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-32" />
            <Skeleton className="h-11 w-28" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
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
