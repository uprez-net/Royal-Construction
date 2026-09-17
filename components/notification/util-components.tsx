import { cn } from "@/lib/utils";
import { PageSkeleton, Skeleton } from "../ui/skeleton";
import { Inbox } from "lucide-react";

function UnreadDot({ isUnread }: { isUnread: boolean }) {
  return (
    <span
      className={cn(
        isUnread
          ? "absolute right-1 top-1 size-2 rounded-full bg-[#C6923A]"
          : "opacity-0",
      )}
    />
  );
}

function InboxLoading() {
  return (
    <PageSkeleton label="Loading notifications" className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </PageSkeleton>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <Inbox className="size-10 text-[#C6923A]" />
      <p className="text-sm text-slate-500">No notifications yet</p>
    </div>
  );
}

export { UnreadDot, InboxLoading, EmptyState };
