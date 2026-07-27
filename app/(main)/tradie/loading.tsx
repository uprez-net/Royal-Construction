import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the Tradie Scheduling & Coordination page.
 *
 * A `loading.tsx` also gives the route its own <Suspense> boundary, which is
 * required here: the page renders on demand (`connection()`) and its data path
 * touches request-time APIs (`new Date()` inside the coordination dashboard).
 * Under Cache Components that dynamic access must sit inside a Suspense boundary
 * or `next build` fails with "Uncached data was accessed outside of <Suspense>".
 * Every sibling page in (main) already has one; this brings /tradie in line.
 */
export default function TradieCoordinationSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading tradie coordination</span>

      {/* Header card */}
      <div className="rounded-lg border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[72px] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-9 rounded-lg" />

            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-44 rounded-lg" />
        <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Schedule rows */}
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border border-border/70 bg-card px-4 py-4 shadow-sm"
          >
            <Skeleton className="size-10 rounded-full" />

            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-32" />
            </div>

            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
