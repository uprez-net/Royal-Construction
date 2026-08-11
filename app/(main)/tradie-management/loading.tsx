import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the real layout of `TradieManagementClient` (flat card header, three
 * metric cards, wrapping toolbar, category grid) so the skeleton→content swap
 * does not flash a different design.
 */
export default function TradieManagementSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading tradies</span>

      {/* Header card */}
      <div className="rounded-lg border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[72px] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-9 rounded-lg" />

            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>

            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-44 rounded-lg" />
        <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="relative rounded-lg border border-border/70 bg-card p-4 shadow-sm"
          >
            <Skeleton className="absolute right-3 top-3 h-5 w-8 rounded-full" />

            <Skeleton className="mb-3 size-10 rounded-lg" />

            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
