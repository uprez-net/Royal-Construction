import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectDetailLoading() {
  return (
    <div
      className="space-y-4 pb-4"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading project details</span>

      {/* Header Skeleton — mirrors the flat light header in project-header.tsx */}
      <section className="rounded-xl border border-border/70 bg-card p-6 px-7 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      </section>

      {/* Stat Cards Skeleton */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="mb-2 flex items-start justify-between">
              <Skeleton className="size-11 rounded-2xl" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-9 w-32" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
        ))}
      </section>

      {/* Tabs Layout Skeleton */}
      <section className="space-y-4">
        <div className="flex flex-wrap gap-x-1 border-b-2 border-border/60 mb-5">
          {Array.from({ length: 7 }).map((_, i) => (
             <Skeleton key={i} className="h-11 w-28 rounded-t-md rounded-b-none" />
          ))}
        </div>

        {/* Tab Content Skeleton (Overview Tab structure) */}
        <section className="grid gap-4 xl:grid-cols-[1fr_2fr]">
          <div className="space-y-4">
             <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
                <Skeleton className="h-3 w-24 mb-6" />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                   {/* Double width for first row (contract value) */}
                   <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                     <Skeleton className="h-15 w-full rounded-lg" />
                     <Skeleton className="h-15 w-full rounded-lg" />
                   </div>
                   {Array.from({ length: 7 }).map((_, i) => (
                      <Skeleton key={i} className="h-15 w-full rounded-lg" />
                   ))}
                </div>
                <div className="mt-4 flex gap-2">
                   <Skeleton className="h-8 w-28 rounded-lg" />
                   <Skeleton className="h-8 w-24 rounded-lg" />
                   <Skeleton className="h-8 w-28 rounded-lg" />
                </div>
             </div>
          </div>
          <div className="space-y-4">
             {/* Chart Skeleton */}
             <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
               <div className="flex justify-between items-start mb-6">
                 <div>
                   <Skeleton className="h-5 w-40 mb-2" />
                   <Skeleton className="h-3.5 w-64" />
                 </div>
                 <Skeleton className="h-8 w-20 rounded-lg" />
               </div>
               <Skeleton className="h-64 w-full rounded-xl" />
             </div>
             {/* Activity Log Skeleton */}
             <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
                <Skeleton className="h-3 w-32 mb-6" />
                <div className="space-y-6 relative pl-7 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border before:rounded-full">
                   {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="relative pb-2">
                         <div className="absolute left-[-27.5px] top-1 size-2.5 rounded-full border-2 border-card bg-muted-foreground/30 ring-2 ring-offset-background z-10" />
                         <div className="space-y-2.5 w-full">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-full max-w-md" />
                            <Skeleton className="h-3 w-40" />
                         </div>
                      </div>
                   ))}
                </div>
             </div>
          </div>
        </section>
      </section>
    </div>
  );
}
