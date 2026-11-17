"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWhatsAppAvailability } from "@/context/WhatsAppAvailabilityContext";
import {
  fetchWhatsAppThread,
  markWhatsAppRead,
} from "@/lib/leads/whatsapp-service";
import { mergeWhatsAppMessages } from "@/lib/leads/whatsapp-format";
import type {
  WhatsAppMessageDto,
  WhatsAppThreadDto,
} from "@/lib/leads/whatsapp-types";

/**
 * How often an open thread re-reads itself. A reply that lands while the
 * modal is open has to appear without a reload (issue #333); the webhook
 * writes it within seconds, so a poll is the whole mechanism. Each tick is a
 * function invocation and a database read, and returning to the tab re-reads
 * at once, so it need not be quick. Off entirely when WhatsApp is.
 */
export const WHATSAPP_THREAD_POLL_MS = 30_000;

type State = {
  thread: WhatsAppThreadDto | null;
  /** Pages loaded with "Load older", kept across polls of the newest page. */
  older: WhatsAppMessageDto[];
  olderCursor: string | null;
  /** Messages this screen sent, shown until a poll returns them. */
  local: WhatsAppMessageDto[];
  error: string | null;
  refreshing: boolean;
  loadingOlder: boolean;
  lastUpdatedAt: Date | null;
};

const INITIAL: State = {
  error: null,
  lastUpdatedAt: null,
  loadingOlder: false,
  local: [],
  older: [],
  olderCursor: null,
  refreshing: false,
  thread: null,
};

/**
 * The open WhatsApp thread for one lead: first load, polling while the tab is
 * visible, "Load older" paging and a manual refresh with a visible
 * last-updated time. Marks the thread read when it opens and whenever a poll
 * brings unread messages in while it is on screen.
 */
export function useLeadWhatsAppThread(leadId: number) {
  const [state, setState] = useState<State>(INITIAL);
  const inFlight = useRef<AbortController | null>(null);
  const whatsappEnabled = useWhatsAppAvailability().enabled;

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState((prev) => ({ ...prev, refreshing: true }));
    try {
      const thread = await fetchWhatsAppThread(leadId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        error: null,
        lastUpdatedAt: new Date(),
        // A locally-added message the server now returns is dropped from the
        // local list; the server's copy carries the current status.
        local: prev.local.filter(
          (message) => !thread.messages.some((m) => m.id === message.id),
        ),
        // New arrivals push the oldest messages off the newest page, but the
        // cursor still starts below the first page loaded. Keep what fell off
        // so it neither vanishes nor waits on "Load older".
        older: mergeWhatsAppMessages(
          prev.older,
          (prev.thread?.messages ?? []).filter(
            (message) => !thread.messages.some((m) => m.id === message.id),
          ),
        ),
        // Only the first load sets the cursor; after that "Load older" owns it.
        olderCursor: prev.thread ? prev.olderCursor : thread.olderCursor,
        refreshing: false,
        thread,
      }));
      if (thread.unreadCount > 0) {
        // Retried by the next refresh (the count is still above zero); said
        // here so a badge that never clears has a reason on screen.
        void markWhatsAppRead(leadId).catch((markError: unknown) => {
          if (controller.signal.aborted) return;
          setState((prev) => ({
            ...prev,
            error:
              markError instanceof Error && markError.message
                ? markError.message
                : "Couldn't mark these messages as read, so the unread count may stay. It will try again on the next refresh.",
          }));
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "Could not load the WhatsApp conversation.",
        refreshing: false,
      }));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [leadId]);

  const loadOlder = useCallback(async () => {
    const cursor = state.olderCursor;
    if (!cursor || state.loadingOlder) return;
    setState((prev) => ({ ...prev, loadingOlder: true }));
    try {
      const page = await fetchWhatsAppThread(leadId, { before: cursor });
      setState((prev) => ({
        ...prev,
        loadingOlder: false,
        older: mergeWhatsAppMessages(page.messages, prev.older),
        olderCursor: page.olderCursor,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "Could not load older messages.",
        loadingOlder: false,
      }));
    }
  }, [leadId, state.olderCursor, state.loadingOlder]);

  /** Show a message this screen just sent, before the next poll. */
  const addLocal = useCallback((message: WhatsAppMessageDto) => {
    setState((prev) => ({
      ...prev,
      local: mergeWhatsAppMessages(prev.local, [message]),
    }));
  }, []);

  useEffect(() => {
    // The first load, then a poll only while somebody can see the page. With
    // WhatsApp off the first load still says why; nothing would change after.
    const first = window.setTimeout(() => void refresh(), 0);
    if (!whatsappEnabled) {
      return () => {
        window.clearTimeout(first);
        inFlight.current?.abort();
      };
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, WHATSAPP_THREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
    };
  }, [refresh, whatsappEnabled]);

  const messages = mergeWhatsAppMessages(
    state.older,
    state.local,
    state.thread?.messages ?? [],
  );

  return {
    addLocal,
    error: state.error,
    hasOlder: state.olderCursor !== null,
    lastUpdatedAt: state.lastUpdatedAt,
    loadOlder,
    loadingOlder: state.loadingOlder,
    messages,
    refresh,
    refreshing: state.refreshing,
    thread: state.thread,
  };
}
