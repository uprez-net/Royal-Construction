import {
  DataTableSkeleton,
  MetricCardSkeleton,
  PageSkeleton,
  Skeleton,
} from "@/components/ui/skeleton";
import { KpiBand } from "@/components/common/kpi-band";
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

        <KpiBand className="grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricCardSkeleton key={i} foot />
          ))}
        </KpiBand>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <GraphCardSkeleton />
        <GraphCardSkeleton />
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.45fr]">
        <GraphCardSkeleton />
        <GraphCardSkeleton />
      </div>

      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
        <div className="flex flex-col gap-4 border-b px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-10 w-full rounded-lg sm:w-72" />
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
        </div>
        <div className="space-y-4 p-4 md:p-0">
          <DataTableSkeleton columnCount={7} flush />
          <div className="flex flex-col items-center gap-3 pt-2 md:px-4 md:pb-4">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-9 w-64 max-w-full rounded-md" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
          <div className="p-4 md:p-0">
            <DataTableSkeleton
              columnCount={5}
              rowCount={4}
              mobileColumns={1}
              flush
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
          <div className="flex items-center justify-between border-b px-4 py-4">
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
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
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
