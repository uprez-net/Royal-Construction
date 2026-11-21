"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWhatsAppAvailability } from "@/context/WhatsAppAvailabilityContext";
import {
  fetchProjectWhatsApp,
  markProjectWhatsAppRead,
  PROJECT_WHATSAPP_CHANGED,
} from "@/lib/projects/whatsapp-service";
import type {
  ProjectWhatsAppMessageDto,
  ProjectWhatsAppThreadDto,
} from "@/lib/projects/whatsapp-types";

/**
 * How often an open group re-reads itself; quicker while it is being made.
 * Each tick is a function invocation and a database read, and returning to
 * the tab re-reads at once. Off entirely when WhatsApp is.
 */
export const PROJECT_WHATSAPP_POLL_MS = 30_000;
/** The header only shows the group's state and unread count. */
export const PROJECT_WHATSAPP_HEADER_POLL_MS = 60_000;
const CREATING_POLL_MS = 10_000;

function mergeMessages(
  ...lists: readonly (readonly ProjectWhatsAppMessageDto[])[]
): ProjectWhatsAppMessageDto[] {
  const byId = new Map<string, ProjectWhatsAppMessageDto>();
  for (const list of lists)
    for (const message of list) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.id.localeCompare(b.id)
      : a.occurredAt.localeCompare(b.occurredAt),
  );
}

type State = {
  thread: ProjectWhatsAppThreadDto | null;
  older: ProjectWhatsAppMessageDto[];
  olderCursor: string | null;
  local: ProjectWhatsAppMessageDto[];
  error: string | null;
  loadingOlder: boolean;
};

const INITIAL: State = {
  error: null,
  loadingOlder: false,
  local: [],
  older: [],
  olderCursor: null,
  thread: null,
};

/**
 * A project's WhatsApp group: first load, polling while the page is visible,
 * "Load older", and a refresh whenever another part of the page changes the
 * group (the header's create/link, the comms tab's send).
 *
 * `markRead` is for the screen that shows the conversation; the header only
 * reads the group's state and must not clear the unread count.
 */
export function useProjectWhatsApp(
  projectId: string,
  options: {
    readonly markRead?: boolean;
    readonly enabled?: boolean;
    readonly pollMs?: number;
  } = {},
) {
  const {
    markRead = false,
    enabled = true,
    pollMs = PROJECT_WHATSAPP_POLL_MS,
  } = options;
  const [state, setState] = useState<State>(INITIAL);
  const inFlight = useRef<AbortController | null>(null);
  // Project groups go through the WhatsApp bridge, not Meta: they poll when
  // the bridge is configured, whether or not lead messaging is on.
  const whatsappEnabled = useWhatsAppAvailability().groups;

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const thread = await fetchProjectWhatsApp(projectId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        error: null,
        local: prev.local.filter(
          (message) => !thread.messages.some((m) => m.id === message.id),
        ),
        older: mergeMessages(
          prev.older,
          (prev.thread?.messages ?? []).filter(
            (message) => !thread.messages.some((m) => m.id === message.id),
          ),
        ),
        olderCursor: prev.thread?.group ? prev.olderCursor : thread.olderCursor,
        thread,
      }));
      if (markRead && (thread.group?.unreadCount ?? 0) > 0) {
        // Retried by the next refresh (the count is still above zero).
        void markProjectWhatsAppRead(projectId).catch((markError: unknown) => {
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
            : "Could not load the project's WhatsApp group.",
      }));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [markRead, projectId]);

  const loadOlder = useCallback(async () => {
    const cursor = state.olderCursor;
    if (!cursor || state.loadingOlder) return;
    setState((prev) => ({ ...prev, loadingOlder: true }));
    try {
      const page = await fetchProjectWhatsApp(projectId, { before: cursor });
      setState((prev) => ({
        ...prev,
        loadingOlder: false,
        older: mergeMessages(page.messages, prev.older),
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
  }, [projectId, state.loadingOlder, state.olderCursor]);

  const addLocal = useCallback((message: ProjectWhatsAppMessageDto) => {
    setState((prev) => ({
      ...prev,
      local: mergeMessages(prev.local, [message]),
    }));
  }, []);

  const creating = state.thread?.group?.status === "CREATING";

  useEffect(() => {
    if (!enabled) return;
    // With WhatsApp off the first load still says why (the header shows it);
    // nothing would change after, so there is no timer to run.
    const polling = whatsappEnabled;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = polling
      ? window.setInterval(
          () => {
            if (document.visibilityState === "visible") void refresh();
          },
          creating ? CREATING_POLL_MS : pollMs,
        )
      : undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string }>).detail;
      if (detail?.projectId === projectId) void refresh();
    };
    if (polling) document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(PROJECT_WHATSAPP_CHANGED, onChanged);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(PROJECT_WHATSAPP_CHANGED, onChanged);
      inFlight.current?.abort();
    };
  }, [creating, enabled, pollMs, projectId, refresh, whatsappEnabled]);

  return {
    addLocal,
    error: state.error,
    hasOlder: state.olderCursor !== null,
    loadOlder,
    loadingOlder: state.loadingOlder,
    messages: mergeMessages(
      state.older,
      state.local,
      state.thread?.messages ?? [],
    ),
    refresh,
    thread: state.thread,
  };
}
