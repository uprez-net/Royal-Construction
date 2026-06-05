import {
  Archive,
  Bell,
  CheckCheck,
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCcw,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useNotification } from "@/context/NotificationContext";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { formatDistanceToNowStrict } from "date-fns";
import { Skeleton } from "../ui/skeleton";

type InboxTab = "all" | "unread";

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

export function Notifications({ maxHeight = 400 }: { maxHeight?: number }) {
  const [activeTab, setActiveTab] = useState<InboxTab>("all");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const {
    notifications,
    isLoading,
    fetchNotifications,
    markNotificationAsRead,
    markAllAsRead,
    archiveNotification,
  } = useNotification();

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const filtered = useMemo(() => {
    if (activeTab === "unread") {
      return notifications.filter((n) => !n.isRead && !n.isArchived);
    }
    return notifications.filter((n) => !n.isArchived);
  }, [notifications, activeTab]);

  async function handleRefresh() {
    await fetchNotifications();
  }

  async function handleMarkAll() {
    try {
      setBusyAll(true);
      await markAllAsRead();
      //   await fetchNotifications();
    } finally {
      setBusyAll(false);
    }
  }

  async function handleMarkOne(id: string) {
    try {
      setBusyId(id);
      await markNotificationAsRead(id);
      //   await fetchNotifications();
    } finally {
      setBusyId(null);
    }
  }

  async function handleArchive(id: string) {
    try {
      setBusyId(id);
      await archiveNotification(id);
      //   await fetchNotifications();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative size-10 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
        onClick={() => setNotificationsOpen((value) => !value)}
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        <UnreadDot isUnread={unreadCount > 0} />
      </Button>
      {notificationsOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] w-96 overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.16_0.03_249.8)] text-slate-100 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <Inbox className="size-7 text-teal-300" />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">Notifications</p>
                  {unreadCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="border border-teal-400/20 bg-teal-400/10 text-teal-200"
                    >
                      {unreadCount} unread
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Operational updates and reminders
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleRefresh}
                    className="size-9 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white"
                    aria-label="Refresh"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-teal-300" />
                    ) : (
                      <RefreshCcw className="h-4 w-4 text-slate-300" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border border-white/10 bg-[oklch(0.16_0.03_249.8)] text-white">
                  Refresh
                </TooltipContent>
              </Tooltip>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setNotificationsOpen(false)}
                className="size-9 rounded-xl text-slate-300 hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-slate-300" />
              </Button>
            </div>
          </div>

          {/* Tabs Selector */}
          <div className="flex items-center justify-between gap-3 px-4 pt-2">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as InboxTab)}
            >
              <TabsList className="border border-white/10 bg-white/5">
                <TabsTrigger
                  value="all"
                  className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="unread"
                  className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white"
                >
                  Unread
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              size="sm"
              onClick={handleMarkAll}
              disabled={busyAll || unreadCount === 0}
              className={cn(
                "h-9 rounded-xl border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white",
              )}
            >
              {busyAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-4 w-4 text-teal-300" />
              )}
              Mark all read
            </Button>
          </div>
          <ScrollArea
            className="m-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3"
            style={{ height: Math.min(maxHeight, 520) }}
          >
            {isLoading ? (
              <InboxLoading />
            ) : (
              <div
                className="space-y-1"
                key={`notifications-${activeTab}-length-${filtered.length}`}
              >
                {filtered.map((n) => {
                  const title = n.subject ?? "No title";
                  const body = n.body ?? "";
                  const url = n.primaryAction
                    ? n.primaryAction.redirect!
                    : null;
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
                            <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                              {body}
                            </p>
                          )}

                          {(url || (n as any)?.payload) && (
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
                                <a
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
                                </a>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
