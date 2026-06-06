import { Bell, CheckCheck, Inbox, Loader2, RefreshCcw, X } from "lucide-react";
import { Button } from "../ui/button";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useNotification } from "@/context/NotificationContext";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  EmptyState,
  InboxLoading,
  UnreadDot,
} from "../notification/util-components";
import { NotificationItem } from "../notification/notification-item";

type InboxTab = "all" | "unread";

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
    <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10 rounded-lg border border-white/10 bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          <UnreadDot isUnread={unreadCount > 0} />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={12}
        className="min-w-106 overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.16_0.03_249.8)] p-0 text-slate-100 shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <Inbox className="size-7 text-teal-300" />
            <div>
              <div className="flex items-center gap-2">
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
              <p className="text-xs text-slate-400 mt-1">
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
                className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white hover:bg-white/5 hover:text-white"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white hover:bg-white/5 hover:text-white"
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
              {filtered.length > 0 ? (
                filtered.map((n) => (
                  <NotificationItem
                    key={n.id}
                    n={n}
                    busyId={busyId}
                    handleMarkOne={handleMarkOne}
                    handleArchive={handleArchive}
                  />
                ))
              ) : (
                <EmptyState />
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
