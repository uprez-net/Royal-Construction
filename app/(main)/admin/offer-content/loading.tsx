import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OfferContentSkeleton() {
  return (
    <PageSkeleton label="Loading offer pre-fill content" className="space-y-6">
      {/* Same surface and padding as PageHeroCard, so the swap to the loaded
          page does not flash from a white card to a gold one. */}
      <div className="relative overflow-hidden rounded-lg border border-royal-gold/20 bg-linear-to-br from-royal-gold-light to-card px-4 py-8 shadow-sm sm:px-6 sm:py-10">
        <div className="pointer-events-none absolute -right-12 -top-10 size-40 rounded-full bg-royal-gold/10" />
        <div className="relative flex items-start gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-4 w-2/3 max-w-md" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm">
        <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 md:flex md:min-w-190 md:gap-0">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
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
