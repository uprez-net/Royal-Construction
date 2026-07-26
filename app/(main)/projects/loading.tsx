import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <div className="grid gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading projects</span>

      {/* KPI Skeleton Grid */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>

      {/* Main Section */}
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-3 border-b border-border px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          {/* Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-32 rounded-full" />
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 gap-3">
              <Skeleton className="h-11 w-full rounded-lg md:max-w-xs" />
              <Skeleton className="h-11 w-24 rounded-lg" />
            </div>
            <Skeleton className="h-[52px] w-[104px] rounded-lg" />
          </div>

          {/* Project Cards Grid */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-lg border border-border/70 bg-card"
              >
                <div className="h-1 bg-muted" />
                <div className="space-y-4 p-5">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-12" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Skeleton className="h-12 w-full rounded" />
                    <Skeleton className="h-12 w-full rounded" />
                    <Skeleton className="h-12 w-full rounded" />
                  </div>
                </div>
                <div className="border-t border-border bg-muted/30 px-5 py-3">
                  <Skeleton className="ml-auto h-4 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
