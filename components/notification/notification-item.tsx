import { cn } from "@/lib/utils";
import type { Notification } from "@novu/js";
import { formatDistanceToNowStrict } from "date-fns";
import { UnreadDot } from "./util-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Archive, CheckCheck, ExternalLink } from "lucide-react";
import { Loader2 } from "lucide-react";
import Link from "next/link";

type NotificationItemExtended = Notification & { payload?: string };

export function NotificationItem({
  n,
  busyId,
  handleMarkOne,
  handleArchive,
}: {
  n: NotificationItemExtended;
  busyId: string | null;
  handleMarkOne: (id: string) => Promise<void>;
  handleArchive: (id: string) => Promise<void>;
}) {
  const title = n.subject ?? "No title";
  const body = n.body ?? "";
  const url = n.primaryAction ? n.primaryAction.redirect! : null;
  const createdAt = n.createdAt ? new Date(n.createdAt) : null;
  const isBusy = busyId === n.id;

  return (
    <div
      key={n.id}
      className={cn(
        "group rounded-2xl border p-3 transition-colors",
        "border-white/10 bg-white/5 hover:bg-white/10",
        !n.isRead &&
          "border-primary/30 shadow-[0_0_0_1px_rgba(13,148,136,0.1)]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5">
          <UnreadDot isUnread={!n.isRead} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">
                {title}
              </p>
              {createdAt && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatDistanceToNowStrict(createdAt, {
                    addSuffix: true,
                  })}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white"
                    onClick={() => handleMarkOne(n.id)}
                    disabled={isBusy || n.isRead}
                    aria-label="Mark as read"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCheck className="h-4 w-4 text-teal-300" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border border-white/10 bg-[oklch(0.16_0.03_249.8)] text-white">
                  Mark read
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white"
                    onClick={() => handleArchive(n.id)}
                    disabled={isBusy}
                    aria-label="Archive"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4 text-slate-300" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border border-white/10 bg-[oklch(0.16_0.03_249.8)] text-white">
                  Archive
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {body && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-300">{body}</p>
          )}

          {(url || (n as NotificationItemExtended)?.payload) && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {!n.isRead ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">
                    Unread
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                    Read
                  </span>
                )}
              </div>

              {url ? (
                <Link
                  href={url.url}
                  target={url.target}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/15"
                  onClick={() => {
                    // nice UX: mark read when user engages
                    if (!n.isRead) handleMarkOne(n.id);
                  }}
                >
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
