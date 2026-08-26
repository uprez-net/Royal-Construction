import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OfferContentSkeleton() {
  return (
    <PageSkeleton label="Loading offer pre-fill content" className="space-y-6">
      <div className="rounded-lg border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm">
        <div className="flex min-w-190 gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <div className="space-y-2 border-b border-border/70 p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex justify-end border-t px-6 py-4">
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>
    </PageSkeleton>
  );
}
