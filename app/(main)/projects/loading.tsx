import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <div className="grid gap-6">
      {/* KPI Skeleton Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-white p-6 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Main Section */}
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="border-b border-border px-6 py-4 space-y-3">
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

        <div className="p-6 space-y-4">
          {/* Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-32 rounded-full" />
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Skeleton className="h-10 w-full md:w-64 rounded-lg" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24 rounded-lg" />
              <Skeleton className="h-10 w-20 rounded-lg" />
            </div>
          </div>

          {/* Project Cards Grid */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 mt-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-white overflow-hidden">
                <div className="h-1 bg-muted" />
                <div className="p-5 space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-3 gap-2">
                    <Skeleton className="h-12 w-full rounded" />
                    <Skeleton className="h-12 w-full rounded" />
                    <Skeleton className="h-12 w-full rounded" />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border bg-muted/30">
                  <Skeleton className="h-4 w-20 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
