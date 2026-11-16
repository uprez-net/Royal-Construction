import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function ProjectDetailLoading() {
  return (
    <PageSkeleton label="Loading project details" className="space-y-4 pb-4">
      {/* Mirrors project-header.tsx: the title sits on the page, with no card. */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-[1.95rem] w-64" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-11 w-24 sm:h-9" />
        </div>
      </header>
      <section className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm md:block md:p-5"
          >
            <div className="contents md:mb-2 md:flex md:justify-between md:gap-2">
              <Skeleton className="row-span-2 size-9 rounded-xl md:size-11 md:rounded-lg" />
              <Skeleton className="col-start-3 row-span-2 row-start-1 h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="col-start-2 row-start-1 h-6 w-32 md:mt-2 md:h-9 md:w-40" />
            <Skeleton className="col-start-2 row-start-2 mt-1 h-4 w-28 md:w-32" />
          </div>
        ))}
      </section>
      <div className="-mx-3 flex gap-1 overflow-hidden border-b-2 border-border/60 px-3 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28 shrink-0" />
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
