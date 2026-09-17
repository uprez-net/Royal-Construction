import {
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";

export function LeadsContentSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-5">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-48 max-w-full rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>
        <LeadsTableSkeleton />
      </div>
    </>
  );
}

function LeadsTableSkeleton() {
  return (
    <div className="overflow-x-auto p-5">
      <div className="min-w-[720px] overflow-hidden rounded-lg border">
        <div className="grid grid-cols-8 gap-4 border-b bg-muted/40 px-4 py-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-full max-w-20" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-8 items-center gap-4 border-b px-4 py-4 last:border-0"
          >
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-1">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeadsPageSkeleton() {
  return (
    <PageSkeleton label="Loading leads" className="space-y-6">
      <div className="rounded-lg border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-36 rounded-md" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </div>
        </div>
      </div>
      <LeadsContentSkeleton />
    </PageSkeleton>
  );
}

export default LeadsPageSkeleton;
