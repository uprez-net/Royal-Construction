import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export function LeadsContentSkeleton() {
  return (
    <PageSkeleton label="Loading leads" className="space-y-6">
      <div className="-mx-3 flex gap-3 overflow-hidden px-3 *:w-[44%] *:min-w-36 *:shrink-0 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 sm:*:w-auto sm:*:min-w-0 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <MetricCardSkeleton key={index} compact />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-5">
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="h-11 w-20 rounded-md" />
          <Skeleton className="h-11 w-24 rounded-md" />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Skeleton className="h-11 w-full rounded-lg sm:order-2 sm:w-48" />
            <Skeleton className="h-11 flex-1 rounded-full sm:order-1 sm:w-32 sm:flex-none" />
            <Skeleton className="h-11 w-24 rounded-md sm:order-3" />
          </div>
        </div>
        <LeadsTableSkeleton />
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
      <div className="overflow-hidden rounded-lg border border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 px-4 py-8 shadow-sm sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-36 rounded-md" />
            <Skeleton className="h-11 w-40 rounded-md" />
          </div>
        </div>
      </div>
      <LeadsContentSkeleton />
    </div>
  );
}

export default LeadsPageSkeleton;
