import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function WhatsAppBridgeSkeleton() {
  return (
    <PageSkeleton label="Loading the WhatsApp bridge" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-60" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
          <Skeleton className="size-[240px] max-w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-9 w-44 rounded-md" />
          </div>
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border/70 bg-card p-6">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </PageSkeleton>
  );
}
