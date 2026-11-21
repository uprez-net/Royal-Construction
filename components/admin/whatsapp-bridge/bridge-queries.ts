"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  connectBridge,
  disconnectBridge,
  fetchBridgeGroups,
  fetchBridgeQr,
  fetchBridgeSession,
  linkBridgeGroup,
  resyncBridgeGroups,
  searchProjects,
  unlinkBridgeGroup,
  type WhatsAppBridgeSessionDto,
} from "@/lib/whatsapp-bridge/admin-service";

// Admin › WhatsApp bridge's server state, in React Query: one owner for each
// request, its cancellation and its invalidation. An interval refetch reuses a
// request still in flight rather than aborting it, so a slow bridge still
// gets its QR code onto the page.

export const bridgeKeys = {
  groups: ["whatsapp-bridge", "groups"] as const,
  projects: (query: string) =>
    ["whatsapp-bridge", "project-search", query] as const,
  qr: ["whatsapp-bridge", "qr"] as const,
  session: ["whatsapp-bridge", "session"] as const,
};

/** Fast while someone is mid-scan; slow while it just sits connected. */
const PAIRING_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

export function isPairing(session: WhatsAppBridgeSessionDto | undefined) {
  return (
    session?.status === "connecting"
    || session?.status === "awaiting_qr"
    || session?.status === "starting"
  );
}

export function useBridgeSession() {
  return useQuery({
    queryFn: ({ signal }) => fetchBridgeSession(signal),
    queryKey: bridgeKeys.session,
    refetchInterval: (query) =>
      isPairing(query.state.data) ? PAIRING_POLL_MS : IDLE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useBridgeQr(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) => fetchBridgeQr(signal),
    queryKey: bridgeKeys.qr,
    // The code rotates every ~20 seconds.
    refetchInterval: enabled ? PAIRING_POLL_MS : false,
  });
}

export function useBridgeGroups() {
  return useQuery({
    queryFn: ({ signal }) => fetchBridgeGroups(signal).then((r) => r.groups),
    queryKey: bridgeKeys.groups,
  });
}

export function useProjectSearch(query: string) {
  return useQuery({
    queryFn: ({ signal }) =>
      searchProjects(query, signal).then((result) => result.items),
    queryKey: bridgeKeys.projects(query),
    staleTime: 30_000,
  });
}

function useSessionMutation(
  mutationFn: () => Promise<WhatsAppBridgeSessionDto>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (session) => {
      client.setQueryData(bridgeKeys.session, session);
      void client.invalidateQueries({ queryKey: bridgeKeys.qr });
    },
  });
}

export function useConnectBridge() {
  return useSessionMutation(connectBridge);
}

export function useDisconnectBridge() {
  return useSessionMutation(disconnectBridge);
}

function useGroupsMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => client.invalidateQueries({ queryKey: bridgeKeys.groups }),
  });
}

export function useResyncBridgeGroups() {
  return useGroupsMutation(() => resyncBridgeGroups());
}

export function useUnlinkBridgeGroup() {
  return useGroupsMutation((input: { projectId: string; groupJid: string }) =>
    unlinkBridgeGroup(input.projectId, input.groupJid),
  );
}

export function useLinkBridgeGroup() {
  return useGroupsMutation((input: { groupJid: string; projectId: string }) =>
    linkBridgeGroup(input.groupJid, input.projectId),
  );
}

const WHEN = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Australia/Sydney",
});

export function when(iso: string | null | undefined): string {
  return iso ? WHEN.format(new Date(iso)) : "—";
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
