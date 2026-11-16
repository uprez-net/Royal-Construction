import { Bell, CheckCheck, Inbox, Loader2, RefreshCcw, X } from "lucide-react";
import { Button } from "../ui/button";
import { useId, useMemo, useState } from "react";
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
  const headingId = useId();
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
    <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10 rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="size-4" />
          <UnreadDot isUnread={unreadCount > 0} />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        aria-labelledby={headingId}
        align="end"
        sideOffset={12}
        className="w-96 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <Inbox className="size-7 text-royal-gold-ink-text" />
            <div>
              <div className="flex items-center gap-2">
                <p id={headingId} className="font-semibold">
                  Notifications
                </p>
                {unreadCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="border border-royal-gold/20 bg-royal-gold-light text-royal-gold-ink-text"
                  >
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
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
                  className="size-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Refresh"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-royal-gold-ink-text" />
                  ) : (
                    <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="border border-border bg-card text-foreground shadow-lg">
                Refresh
              </TooltipContent>
            </Tooltip>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setNotificationsOpen(false)}
              className="size-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>

        {/* Tabs Selector */}
        <div className="flex items-center justify-between gap-3 px-4 pt-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as InboxTab)}
          >
            <TabsList
              aria-label="Show notifications"
              className="border border-border bg-muted"
            >
              <TabsTrigger
                value="all"
                className="text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground hover:bg-card hover:text-foreground"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground hover:bg-card hover:text-foreground"
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
              "h-9 rounded-xl border border-border bg-card text-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {busyAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-2 h-4 w-4 text-royal-gold-ink-text" />
            )}
            Mark all read
          </Button>
        </div>
        <ScrollArea
          className="m-2 rounded-xl border border-border bg-background px-2 py-3 **:data-[slot='scroll-area-scrollbar']:hidden"
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
