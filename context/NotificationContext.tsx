"use client";

import {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useCallback,
  useEffectEvent,
} from "react";
import { Events, Notification, Novu } from "@novu/js";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { certifierExtractPayloadFromUrl } from "@/components/notification/notification-item";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { notificationSubscriberId } from "@/lib/notification/environment";

interface NotificationContextType {
  notifications: Notification[];
  isLoading: boolean;
  fetchNotifications: () => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  archiveNotification: (notificationId: string) => Promise<void>;
}

const applicationIdentifier = process.env.NEXT_PUBLIC_NOVU_APP_IDENTIFIER!;

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export const NotificationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const dispatch = useAppDispatch();

  // The inbox for the site this page is on: staging and production share one
  // Novu application, and each origin sends to its own subscriber (see
  // lib/notification/environment.ts), so neither sees the other's.
  const subscriberId =
    isLoaded && user && typeof window !== "undefined"
      ? notificationSubscriberId(user.id, window.location.origin)
      : null;

  const novu = useMemo(() => {
    if (!subscriberId) return null;

    return new Novu({
      applicationIdentifier,
      subscriberId,
    });
  }, [subscriberId]);

  const queryKey = useMemo(
    () => ["notifications", subscriberId],
    [subscriberId],
  );

  const {
    data: notifications = [],
    isLoading,
    refetch,
  } = useQuery<Notification[]>({
    queryKey,
    enabled: !!novu,
    queryFn: async () => {
      const response = await novu!.notifications.list({
        limit: 50,
      });

      return response.data?.notifications ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const fetchNotifications = useCallback(async () => {
    try {
      await refetch();
    } catch (error) {
      console.error("Error fetching notifications:", error);
      toast.error("Failed to fetch notifications.");
    }
  }, [refetch]);

  const updateNotificationCache = useCallback(
    (updated: Notification) => {
      queryClient.setQueryData<Notification[]>(queryKey, (old = []) =>
        old.map((notification) =>
          notification.id === updated.id ? updated : notification,
        ),
      );
    },
    [queryClient, queryKey],
  );

  const onNotificationReceived = useEffectEvent(
    (data: Events["notifications.notification_received"]) => {
      queryClient.setQueryData<Notification[]>(queryKey, (old = []) => {
        const exists = old.some(
          (notification) => notification.id === data.result.id,
        );

        if (exists) return old;

        return [data.result, ...old];
      });

      // A certifier reply carrying a checklist opens the extraction popup as
      // it arrives, rather than waiting for someone to notice the bell. The
      // routing rides the redirect url because triggerNotification carries no
      // structured payload; the same predicate backs the click-to-open button
      // in notification-item.tsx.
      const url = data.result.redirect?.url;
      if (url && url.includes("action=certifierExtract")) {
        const payload = certifierExtractPayloadFromUrl(url);
        if (payload) {
          dispatch(openModal({ type: "certifierExtract", payload }));
        }
      }
    },
  );

  const onNotificationUpdated = useEffectEvent(
    (
      data:
        | Events["notification.unread.resolved"]
        | Events["notification.read.resolved"]
        | Events["notification.archive.resolved"],
    ) => {
      if (!data.data) return;

      updateNotificationCache(data.data);
    },
  );

  useEffect(() => {
    if (!novu) return;

    novu.on("notifications.notification_received", onNotificationReceived);

    novu.on("notification.unread.resolved", onNotificationUpdated);

    novu.on("notification.read.resolved", onNotificationUpdated);

    novu.on("notification.archive.resolved", onNotificationUpdated);

    return () => {
      novu.off("notifications.notification_received", onNotificationReceived);

      novu.off("notification.unread.resolved", onNotificationUpdated);

      novu.off("notification.read.resolved", onNotificationUpdated);

      novu.off("notification.archive.resolved", onNotificationUpdated);
    };
  }, [novu]);

  const markNotificationAsRead = useCallback(
    async (notificationId: string) => {
      try {
        const notification = notifications.find(
          (notification) => notification.id === notificationId,
        );

        if (!notification) return;

        await notification.read();
      } catch (error) {
        console.error("Error marking notification as read:", error);
        toast.error("Failed to mark notification as read.");
      }
    },
    [notifications],
  );

  const markAllAsRead = useCallback(async () => {
    try {
      const unreadNotifications = notifications.filter(
        (notification) => !notification.isRead,
      );

      if (unreadNotifications.length === 0) return;

      await Promise.all(
        unreadNotifications.map((notification) => notification.read()),
      );
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      toast.error("Failed to mark all notifications as read.");
    }
  }, [notifications]);

  const archiveNotification = useCallback(
    async (notificationId: string) => {
      try {
        const notification = notifications.find(
          (notification) => notification.id === notificationId,
        );

        if (!notification) return;

        await notification.archive();
      } catch (error) {
        console.error("Error archiving notification:", error);
        toast.error("Failed to archive notification.");
      }
    },
    [notifications],
  );

  const value = useMemo(
    () => ({
      notifications,
      isLoading,
      fetchNotifications,
      markNotificationAsRead,
      markAllAsRead,
      archiveNotification,
    }),
    [
      notifications,
      isLoading,
      fetchNotifications,
      markNotificationAsRead,
      markAllAsRead,
      archiveNotification,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = (): NotificationContextType => {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useNotification must be used within a NotificationProvider",
    );
  }

  return context;
};
