import { Skeleton } from "@/components/ui/skeleton";

export function AgentWorkspaceSkeleton() {
  return (
    <div className="grid h-full max-h-full min-h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-border/70 bg-white md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="order-1 hidden border-r border-border/70 bg-muted/25 p-4 md:flex md:flex-col md:gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="order-2 flex h-[75vh] flex-col">
        <div className="flex items-center gap-3 border-b border-border/70 p-4">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Skeleton className="h-24 w-72 max-w-[80%]" />
        </div>
      </div>
    </div>
  );
}
