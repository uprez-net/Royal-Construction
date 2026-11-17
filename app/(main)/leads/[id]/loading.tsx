import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function LeadDetailLoading() {
  return (
    <PageSkeleton label="Loading lead details" className="space-y-4 pb-4">
      {/* Mirrors lead-header.tsx: the title sits on the page, with no card. */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-32" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-[1.95rem] w-56" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-44" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </header>

      {/* Tabs layout skeleton */}
      <section className="space-y-4">
        <div className="mb-5 grid grid-cols-2 gap-1 sm:flex sm:flex-wrap border-b-2 border-border/60">
          {[28, 44, 24, 24].map((width, i) => (
            <Skeleton
              key={i}
              className="h-11 rounded-t-md rounded-b-none"
              style={{ maxWidth: `${width * 4}px` }}
            />
          ))}
        </div>

        {/* Overview tab structure: one card holding six collapsed sections */}
        <div className="rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
          <div className="border-b border-border/70 p-6 pb-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3.5 w-80" />
          </div>
          <div className="space-y-2 p-6 pt-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="size-4 rounded" />
                </div>

                {/* The first section renders expanded on load */}
                {i === 0 ? (
                  <div className="grid gap-4 pt-4 pb-1 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, field) => (
                      <div key={field} className="space-y-1.5">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-9 w-full rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageSkeleton>
  );
}
