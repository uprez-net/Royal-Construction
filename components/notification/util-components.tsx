import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
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
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[#E2E8F0] bg-white p-3"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-lg bg-[#F7F4EE]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 bg-[#F7F4EE]" />
              <Skeleton className="h-3 w-full bg-[#F7F4EE]" />
              <Skeleton className="h-3 w-1/2 bg-[#F7F4EE]" />
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
      <Inbox className="size-10 text-[#C6923A]" />
      <p className="text-sm text-slate-500">No notifications yet</p>
    </div>
  );
}

export { UnreadDot, InboxLoading, EmptyState };