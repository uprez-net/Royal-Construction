import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export function AgentWorkspaceSkeleton() {
  return (
    <PageSkeleton
      label="Loading operations desk"
      className="flex h-full min-h-full w-full flex-col overflow-hidden bg-card sm:rounded-lg sm:border sm:border-border/70"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Skeleton className="size-11 shrink-0 sm:size-8" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="size-11 shrink-0 sm:size-8" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-72 shrink-0 flex-col gap-3 border-r border-border/70 bg-muted/25 p-4 md:flex">
          <Skeleton className="h-7 w-32" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-48 flex-1 items-center justify-center">
            <Skeleton className="h-24 w-72 max-w-[80%]" />
          </div>
          <div className="border-t border-border/70 p-3">
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
