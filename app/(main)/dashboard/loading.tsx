import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-5 w-56" />
          </div>

          <div className="flex flex-wrap items-center gap-6 lg:justify-end">
            <div className="grid grid-cols-3 gap-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1 text-right">
                  <Skeleton className="ml-auto h-3 w-16" />
                  <Skeleton className="ml-auto h-4 w-8" />
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-12 rounded-md" />
          </div>
        ))}
      </div>

      {/* Active Projects */}
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <Skeleton className="h-6 w-56" />

          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-80 rounded-full" />
            <Skeleton className="h-11 w-24 rounded-full" />
          </div>
        </div>

        <div className="p-5">
          <div className="overflow-hidden rounded-lg border">
            {/* Table Header */}
            <div className="grid grid-cols-7 gap-4 border-b bg-muted/40 px-4 py-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-20" />
              ))}
            </div>

            {/* Table Rows */}
            <div className="space-y-4 p-4">
              {Array.from({ length: 5 }).map((_, row) => (
                <div
                  key={row}
                  className="grid grid-cols-7 items-center gap-4"
                >
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-full rounded-full" />
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1.2fr]">
        {/* Site Manager */}
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-6 w-60" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>

          <div className="p-5">
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-5 gap-4 border-b bg-muted/40 px-4 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-20" />
                ))}
              </div>

              <div className="space-y-4 p-4">
                {Array.from({ length: 4 }).map((_, row) => (
                  <div
                    key={row}
                    className="grid grid-cols-5 items-center gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-4 w-28" />
                    </div>

                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />

                    <div className="flex gap-1">
                      {Array.from({ length: 5 }).map((_, star) => (
                        <Skeleton
                          key={star}
                          className="h-4 w-4 rounded-sm"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Follow Ups */}
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>

          <div className="space-y-4 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>

                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />

                <div className="flex gap-2">
                  <Skeleton className="h-8 w-20 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
