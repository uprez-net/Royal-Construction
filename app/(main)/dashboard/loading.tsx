import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";
import { PAGE_HEADER_CLASS } from "@/components/common/page-header";

export default function DashboardSkeleton() {
  return (
    <PageSkeleton
      label="Loading dashboard"
      className="flex flex-col gap-6 lg:gap-7"
    >
      <section className="flex flex-col gap-4 lg:gap-5">
        <div className={PAGE_HEADER_CLASS}>
          <div className="min-w-0">
            <Skeleton className="h-8 w-48 max-w-full" />
            <Skeleton className="mt-1 h-5 w-32" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricCardSkeleton key={i} compact />
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <GraphCardSkeleton />
        <GraphCardSkeleton />
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.45fr]">
        <GraphCardSkeleton />
        <GraphCardSkeleton />
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-10 w-full rounded-lg sm:w-72" />
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <DataTableSkeleton columnCount={7} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
          <div className="overflow-x-auto p-5">
            <div className="min-w-[480px] overflow-hidden rounded-lg border">
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
                      <Skeleton className="size-10 rounded-full" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <div className="flex gap-1">
                      {Array.from({ length: 5 }).map((_, star) => (
                        <Skeleton key={star} className="size-4 rounded-sm" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="space-y-4 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-5 w-40 max-w-full" />
                  <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

function GraphCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <Skeleton className="h-4 w-44 max-w-full" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="p-5">
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}
