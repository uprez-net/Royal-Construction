import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OfferWorkspaceSkeleton() {
  return (
    <PageSkeleton label="Loading offer workspace" className="space-y-5">
      <div className="space-y-5">
        <div className="rounded-lg border border-border/70 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-64 max-w-full" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm">
          <div className="flex min-w-190 gap-2">
            {Array.from({ length: 10 }).map((_, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-1 flex-col items-center gap-2"
              >
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
            <div className="space-y-2 border-b p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
            <Skeleton className="mb-4 h-4 w-28" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
