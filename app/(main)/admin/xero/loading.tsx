import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function XeroConnectionSkeleton() {
  return (
    <PageSkeleton label="Loading the Xero connection" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-6">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <Skeleton className="h-7 w-28 shrink-0 rounded-full" />
        </div>

        <div className="space-y-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-lg" />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
