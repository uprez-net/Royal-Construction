import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function TradieDetailsSkeleton() {
  return (
    <PageSkeleton label="Loading tradie details" className="space-y-4">
      {/* Back link */}
      <Skeleton className="h-8 w-36 rounded-lg" />

      {/* Header: avatar + title/trade chip, then one primary action + overflow */}
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />

            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Details + performance */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Contact and business details */}
        <div className="rounded-lg bg-card px-4 py-4 border border-border/70 lg:col-span-8">
          <Skeleton className="mb-6 h-5 w-56" />

          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-44" />
              </div>
            ))}
          </div>
        </div>

        {/* Performance */}
        <div className="rounded-lg bg-card px-4 py-4 border border-border/70 lg:col-span-4">
          <Skeleton className="mb-6 h-5 w-32" />

          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-40" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-border/70 p-3"
                >
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>

            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        </div>
      </div>

      {/* Incidents */}
      <div className="rounded-lg bg-card px-4 py-4 border border-border/70">
        <Skeleton className="mb-4 h-5 w-40" />

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/70 p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-32 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>

              <Skeleton className="h-4 w-full max-w-150" />
              <Skeleton className="mt-2 h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
