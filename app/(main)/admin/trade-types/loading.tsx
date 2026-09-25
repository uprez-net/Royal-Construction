import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function TradeTypesLoading() {
  return (
    <PageSkeleton label="Loading trade types" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-28" />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    </PageSkeleton>
  );
}
