import { MetricCardSkeleton, PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OfferPageSkeleton() {
  return (
    <PageSkeleton label="Loading offers" className="space-y-6">
      <div className="rounded-lg border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>

      <div className="rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-4 border-b px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-20 rounded-md" />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-10 w-full max-w-70 rounded-lg" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="overflow-x-auto px-6 pb-6 pt-4">
          <div className="min-w-180 overflow-hidden rounded-lg border">
            <div className="grid grid-cols-10 gap-4 border-b bg-muted/40 px-4 py-4">
              {Array.from({ length: 10 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full max-w-20" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, row) => (
              <div
                key={row}
                className="grid grid-cols-10 gap-4 border-b px-4 py-5 last:border-0"
              >
                {Array.from({ length: 10 }).map((_, col) => (
                  <Skeleton key={col} className="h-4 w-full max-w-24" />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-4">
            <Skeleton className="h-4 w-36" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
