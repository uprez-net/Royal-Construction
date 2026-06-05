import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { Inbox } from "lucide-react";

function UnreadDot({ isUnread }: { isUnread: boolean }) {
  return (
    <span
      className={cn(
        isUnread
          ? "absolute right-1 top-1 size-2 rounded-full bg-primary"
          : "opacity-0",
      )}
    />
  );
}

function InboxLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-cyan-500/15 bg-black/30 p-3"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-lg bg-white/5" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 bg-white/5" />
              <Skeleton className="h-3 w-full bg-white/5" />
              <Skeleton className="h-3 w-1/2 bg-white/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <Inbox className="size-10 text-slate-500" />
      <p className="text-sm text-slate-400">No notifications yet</p>
    </div>
  );
}

export { UnreadDot, InboxLoading, EmptyState };