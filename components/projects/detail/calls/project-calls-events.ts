"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchProjectCallsUnread } from "@/lib/leads/comms-service";

// The project's phone lives in two places — the dialer in the header and the
// Calls log in Comms — plus the badge on the tab. They talk through two window
// events rather than shared state, so each can mount on its own.

const CHANGED = "project-calls:changed";
const OPEN_DIALER = "project-calls:open-dialer";

type Detail = { projectId: string };

/** A call was placed or the log was read: refetch what you show. */
export function announceProjectCallsChange(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<Detail>(CHANGED, { detail: { projectId } }),
  );
}

/** Ask the header's dialer to open (from the Calls log's own button). */
export function requestProjectDialer(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent<Detail>(OPEN_DIALER, { detail: { projectId } }),
  );
}

function useProjectEvent(
  name: string,
  projectId: string,
  handler: () => void,
): void {
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<Detail>).detail?.projectId === projectId)
        handler();
    };
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name, projectId, handler]);
}

export function useProjectCallsChange(
  projectId: string,
  handler: () => void,
): void {
  useProjectEvent(CHANGED, projectId, handler);
}

export function useProjectDialerRequest(
  projectId: string,
  handler: () => void,
): void {
  useProjectEvent(OPEN_DIALER, projectId, handler);
}

/** Inbound calls filed here are matched every six hours; a slow poll is plenty. */
const UNREAD_POLL_MS = 5 * 60_000;

/**
 * Matched inbound calls nobody has opened on this project, for the badge on
 * the Comms tab. Zero, and no request at all, unless `enabled` (ADMIN).
 */
export function useProjectCallsUnread(
  projectId: string,
  enabled: boolean,
): number {
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((value) => value + 1), []);
  useProjectCallsChange(projectId, bump);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () =>
      void fetchProjectCallsUnread(projectId, controller.signal)
        .then((result) => setUnread(result.unread))
        .catch(() => {
          // A badge that fails to load stays as it was; the log still shows all.
        });
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, UNREAD_POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, projectId, tick]);
  return enabled ? unread : 0;
}
