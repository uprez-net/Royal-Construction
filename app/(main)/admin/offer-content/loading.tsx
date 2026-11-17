import { PAGE_HEADER_CLASS } from "@/components/common/page-header";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function OfferContentSkeleton() {
  return (
    <PageSkeleton label="Loading offer pre-fill content" className="space-y-6">
      {/* Same layout and title height as PageHeader, so the swap does not jump. */}
      <div className={PAGE_HEADER_CLASS}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-72 max-w-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-1 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-1 h-4 w-2/3 max-w-md" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/4">
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

      <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
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
