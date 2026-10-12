import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ProjectDetailLoading() {
  return (
    <PageSkeleton label="Loading project details" className="space-y-4 pb-4">
      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-11 w-24 sm:h-9" />
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/70 bg-card p-5 shadow-sm"
          >
            <div className="mb-2 flex justify-between gap-2">
              <Skeleton className="size-11 rounded-2xl" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-9 w-40" />
            <Skeleton className="mt-1 h-4 w-32" />
          </div>
        ))}
      </section>
      <div className="space-y-2 md:hidden">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="hidden flex-wrap gap-1 border-b-2 border-border/60 pb-1 md:flex">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28" />
        ))}
      </div>
      <section className="rounded-lg border border-border/70 bg-card py-4 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border/70 px-6 pb-4 sm:flex-row sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-11 w-32" />
        </div>
        <div className="space-y-5 px-6 pt-5">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </section>
    </PageSkeleton>
  );
}
