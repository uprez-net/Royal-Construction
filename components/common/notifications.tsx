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
          className="relative size-10 rounded-lg border border-[#E2E8F0] bg-white text-slate-500 shadow-sm hover:bg-[#F7F4EE] hover:text-slate-900"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          <UnreadDot isUnread={unreadCount > 0} />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={12}
        className="min-w-96 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white p-0 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center gap-3">
            <Inbox className="size-7 text-[#C6923A]" />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">Notifications</p>
                {unreadCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="border border-[#C6923A]/20 bg-[#C6923A]/10 text-[#8B6420]"
                  >
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
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
                  className="size-9 rounded-xl text-slate-500 hover:bg-[#F7F4EE] hover:text-slate-900"
                  aria-label="Refresh"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#C6923A]" />
                  ) : (
                    <RefreshCcw className="h-4 w-4 text-slate-500" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="border border-[#E2E8F0] bg-white text-slate-900 shadow-lg">
                Refresh
              </TooltipContent>
            </Tooltip>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setNotificationsOpen(false)}
              className="size-9 rounded-xl text-slate-500 hover:bg-[#F7F4EE] hover:text-slate-900"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-slate-500" />
            </Button>
          </div>
        </div>

        {/* Tabs Selector */}
        <div className="flex items-center justify-between gap-3 px-4 pt-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as InboxTab)}
          >
            <TabsList className="border border-[#E2E8F0] bg-[#F7F4EE]">
              <TabsTrigger
                value="all"
                className="text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 hover:bg-white hover:text-slate-900"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-900 hover:bg-white hover:text-slate-900"
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
              "h-9 rounded-xl border border-[#E2E8F0] bg-white text-slate-700 hover:bg-[#F7F4EE] hover:text-slate-900",
            )}
          >
            {busyAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-2 h-4 w-4 text-[#C6923A]" />
            )}
            Mark all read
          </Button>
        </div>
        <ScrollArea
          className="m-2 rounded-xl border border-[#E2E8F0] bg-[#FCFBF8] px-2 py-3 **:data-[slot='scroll-area-scrollbar']:hidden"
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
                    close={() => setNotificationsOpen(false)}
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
