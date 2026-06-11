import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border bg-muted/30 p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-96" />
          </div>

          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-36 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>

        {/* Decorative circles */}
        <Skeleton className="absolute -right-8 top-0 h-40 w-40 rounded-full opacity-20" />
        <Skeleton className="absolute right-16 top-4 h-32 w-32 rounded-full opacity-20" />
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-4 w-6" />
            </div>

            <div className="mt-6 space-y-2">
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        ))}
      </div>

      {/* Active Projects */}
      <div className="rounded-3xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <Skeleton className="h-6 w-56" />

          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-80 rounded-full" />
            <Skeleton className="h-11 w-24 rounded-full" />
          </div>
        </div>

        <div className="p-5">
          <div className="rounded-2xl border overflow-hidden">
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
        <div className="rounded-3xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-6 w-60" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>

          <div className="p-5">
            <div className="rounded-2xl border overflow-hidden">
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
        <div className="rounded-3xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>

          <div className="space-y-4 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border p-4 space-y-3"
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