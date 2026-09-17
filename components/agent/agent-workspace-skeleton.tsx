import { Skeleton } from "@/components/ui/skeleton";

export function AgentWorkspaceSkeleton() {
  return (
    <div className="grid min-h-[40rem] flex-1 overflow-hidden rounded-xl border border-border/70 bg-white md:h-[calc(100dvh-10.5rem)] md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="order-2 hidden border-r border-border/70 bg-muted/25 p-4 md:order-1 md:flex md:flex-col md:gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="order-1 flex flex-col md:order-2">
        <div className="flex items-center gap-3 border-b border-border/70 p-4">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-24 w-72 max-w-[80%]" />
        </div>
      </div>
    </div>
  );
}
